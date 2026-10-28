import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { VIDEO_VOICES, voiceIdForKey, elevenLabsRequestBody, DEFAULT_ELEVENLABS_MODEL } from "./video-ai";
import { getCounter, bumpCounter, monthPeriod } from "./usage-counter";
import { logAction } from "./assistant-audit";

/**
 * Employer Portal AI Assistant — ElevenLabs text-to-speech for spoken
 * replies (Voice Fix Round 2, Section B). Reuses the Resume Video feature's
 * ElevenLabs voice catalog and request-shaping (lib/video-ai.ts) and its
 * server-owned ELEVENLABS_API_KEY — there is no separate key or plan for
 * this feature, and no bring-your-own-key flow (that only exists on the
 * legacy marketing site's /preview page, not in this app).
 *
 * Deliberately reuses TWO pieces of existing infrastructure instead of
 * adding new tables for them:
 *  - The monthly per-employer character cap is a counter in the existing
 *    generic `usage_counters` table (lib/usage-counter.ts, migration 0043),
 *    not a new `assistant_tts_usage` table — `usage_counters` already is
 *    exactly "a scoped counter keyed by kind + period", which is all this
 *    cap needs, and its bump is already atomic (bump_usage_counter RPC).
 *  - The per-text-hash+voice audio cache is Supabase Storage object
 *    existence in a private bucket (migration 0074), not a cache table —
 *    the object's own existence at a deterministic path IS the cache
 *    index, so there is nothing a separate row would track that the path
 *    doesn't already encode.
 */

const TABLE_KIND = "assistant_tts_chars";
const BUCKET = "assistant-tts-cache";

/** Per-request character cap — enforced before any ElevenLabs call. */
export const TTS_REQUEST_CHAR_CAP = 2000;

/** Monthly per-employer character cap, env-overridable. */
export function ttsMonthlyCharCap(): number {
  const v = Number(process.env.ASSISTANT_TTS_MONTHLY_CHAR_CAP);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 300_000;
}

/** The voice catalog this picker offers — the SAME keys the Resume Video
 *  feature is configured with, never the full ElevenLabs account catalog. */
export function assistantTtsVoices(): { key: string; label: string; gender: "female" | "male" }[] {
  return VIDEO_VOICES.map((v) => ({ key: v.key, label: v.label, gender: v.gender }));
}

export const ASSISTANT_TTS_DEFAULT_VOICE = VIDEO_VOICES[0].key;

let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

/** sha256 of the exact text, namespaced by voice key — a different voice
 *  for the same words is a cache miss, by design. */
export function ttsCacheKey(voiceKey: string, text: string): string {
  return createHash("sha256").update(`${voiceKey}:${text}`).digest("hex");
}

function cachePath(voiceKey: string, hash: string): string {
  return `${voiceKey}/${hash}.mp3`;
}

/** Best-effort: a cache miss AND a cache-store outage both resolve to null
 *  (the caller falls through to generating fresh audio either way). */
async function getCachedAudio(voiceKey: string, hash: string): Promise<Buffer | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c.storage.from(BUCKET).download(cachePath(voiceKey, hash));
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

/** Best-effort, fire-and-forget from the caller's point of view: caching is
 *  an optimization, never something a request should fail over. `upsert:
 *  false` means a race between two identical requests just has the loser's
 *  upload rejected (harmless — the content is identical by construction,
 *  since the path IS the content hash). */
async function putCachedAudio(voiceKey: string, hash: string, bytes: Buffer): Promise<void> {
  const c = db();
  if (!c) return;
  try {
    await c.storage.from(BUCKET).upload(cachePath(voiceKey, hash), bytes, { contentType: "audio/mpeg", upsert: false });
  } catch {
    /* best-effort */
  }
}

export type AssistantTtsResult =
  | { ok: true; audio: Buffer; cached: boolean }
  | { ok: false; reason: "too_long" | "cap" | "not_configured" | "provider_error"; message: string };

const CAP_MESSAGE = "Spoken replies have hit this account's monthly voice limit — text replies keep working, and voice resets next month.";
const NOT_CONFIGURED_MESSAGE = "Voice replies aren't configured on this server.";

/** Generate (or serve from cache) one ElevenLabs TTS reply for the
 *  Assistant's spoken output. Never throws — every failure resolves to a
 *  typed `{ ok: false, reason }`, so the route (and ultimately the client's
 *  speechSynthesis fallback) always has something concrete to act on. */
export async function generateAssistantTts(params: {
  employerId: string;
  actorUserId: string;
  actorEmail: string | null;
  text: string;
  voiceKey: string;
}): Promise<AssistantTtsResult> {
  const text = (params.text || "").trim();
  if (!text) return { ok: false, reason: "too_long", message: "No text to speak." };
  if (text.length > TTS_REQUEST_CHAR_CAP) {
    return { ok: false, reason: "too_long", message: `Replies longer than ${TTS_REQUEST_CHAR_CAP} characters can't be spoken in one request.` };
  }
  const voiceKey = VIDEO_VOICES.some((v) => v.key === params.voiceKey) ? params.voiceKey : ASSISTANT_TTS_DEFAULT_VOICE;
  const hash = ttsCacheKey(voiceKey, text);

  const fromCache = await getCachedAudio(voiceKey, hash);
  if (fromCache) return { ok: true, audio: fromCache, cached: true };

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured", message: NOT_CONFIGURED_MESSAGE };

  // Reserve the monthly budget BEFORE spending ElevenLabs credits — a cache
  // hit above never reaches here, so repeated/templated phrases never count
  // against the cap after their first generation.
  const period = monthPeriod();
  const usedThisMonth = (await getCounter(params.employerId, TABLE_KIND, period)) ?? 0;
  if (usedThisMonth + text.length > ttsMonthlyCharCap()) {
    await logAction({
      employerId: params.employerId,
      actorUserId: params.actorUserId,
      actorEmail: params.actorEmail,
      action: "assistant_tts_cap_reached",
      targetType: null,
      targetId: null,
      payload: { usedThisMonth, requested: text.length, cap: ttsMonthlyCharCap() },
      status: "failed",
    });
    return { ok: false, reason: "cap", message: CAP_MESSAGE };
  }

  try {
    const voiceId = voiceIdForKey(voiceKey);
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify(elevenLabsRequestBody(text, process.env.ELEVENLABS_MODEL_ID || DEFAULT_ELEVENLABS_MODEL)),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error("[assistant-tts] ElevenLabs HTTP", res.status, (await res.text().catch(() => "")).slice(0, 300));
      return { ok: false, reason: "provider_error", message: "Voice generation failed." };
    }
    const audio = Buffer.from(await res.arrayBuffer());
    await bumpCounter(params.employerId, TABLE_KIND, period, text.length);
    void putCachedAudio(voiceKey, hash, audio); // best-effort, never blocks the reply
    return { ok: true, audio, cached: false };
  } catch (e) {
    console.error("[assistant-tts] ElevenLabs call threw", e instanceof Error ? e.message : e);
    return { ok: false, reason: "provider_error", message: "Voice generation failed." };
  }
}
