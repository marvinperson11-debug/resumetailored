import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-employer Assistant persona + voice settings (assistant_persona,
 * migration 0073) for Voice Mode (Prompt 7). One row per employer, created
 * lazily on first read with the default name "Taylor" and no employer
 * display name yet.
 *
 * This module owns ONLY the row — DB reads/writes and the deterministic
 * (never-LLM) text parsers that decide what to write. The spoken-reply
 * composition and the first-voice-session onboarding script live in
 * lib/assistant-voice.ts, which calls into this module.
 */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export const DEFAULT_ASSISTANT_NAME = "Taylor";
export const MAX_NAME_LENGTH = 40;

export interface PersonaRow {
  employerId: string;
  assistantName: string;
  employerDisplayName: string | null;
  voiceIntroduced: boolean;
  ttsVoice: string | null;
  ttsRate: number | null;
  createdAt: string;
  updatedAt: string;
}

const COLS = "employer_id, assistant_name, employer_display_name, voice_introduced, tts_voice, tts_rate, created_at, updated_at";

function mapRow(r: Record<string, unknown>): PersonaRow {
  return {
    employerId: (r.employer_id as string) || "",
    assistantName: (r.assistant_name as string) || DEFAULT_ASSISTANT_NAME,
    employerDisplayName: (r.employer_display_name as string) ?? null,
    voiceIntroduced: !!r.voice_introduced,
    ttsVoice: (r.tts_voice as string) ?? null,
    ttsRate: typeof r.tts_rate === "number" ? r.tts_rate : null,
    createdAt: (r.created_at as string) || "",
    updatedAt: (r.updated_at as string) || "",
  };
}

function defaultRow(employerId: string): PersonaRow {
  return {
    employerId,
    assistantName: DEFAULT_ASSISTANT_NAME,
    employerDisplayName: null,
    voiceIntroduced: false,
    ttsVoice: null,
    ttsRate: null,
    createdAt: "",
    updatedAt: "",
  };
}

/** The persona row for this employer, creating the default row on first
 *  read. Never throws — a DB hiccup degrades to the in-memory default
 *  (same "fail open to a safe default" posture as every other assistant_*
 *  reader in this codebase, e.g. lib/assistant-ack-settings.ts), so the
 *  chat header always has a name to show even if nothing was ever
 *  persisted. */
export async function getOrCreatePersona(employerId: string): Promise<PersonaRow> {
  const c = db();
  if (!c || !employerId) return defaultRow(employerId);
  try {
    const { data } = await c.from("assistant_persona").select(COLS).eq("employer_id", employerId).maybeSingle();
    if (data) return mapRow(data);
    const { data: inserted, error } = await c.from("assistant_persona").insert({ employer_id: employerId }).select(COLS).single();
    if (error || !inserted) return defaultRow(employerId);
    return mapRow(inserted);
  } catch (e) {
    console.error("[assistant-persona] getOrCreatePersona threw", e);
    return defaultRow(employerId);
  }
}

async function upsertPatch(employerId: string, patch: Record<string, unknown>): Promise<PersonaRow | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    // Ensure the row exists first (insert-if-absent), then apply the patch —
    // two round trips, but this is a low-frequency settings write, never on
    // the hot chat path.
    await getOrCreatePersona(employerId);
    const { data, error } = await c
      .from("assistant_persona")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("employer_id", employerId)
      .select(COLS)
      .single();
    if (error || !data) return null;
    return mapRow(data);
  } catch (e) {
    console.error("[assistant-persona] upsertPatch threw", { employerId, patch, error: e });
    return null;
  }
}

/** Rename the Assistant itself — from a Settings field, or a deterministic
 *  chat/voice rename intent (see `parseRenameIntent` below). Takes effect
 *  immediately; no approval card, since it changes nothing about any
 *  candidate-facing or job-facing data. */
export async function renameAssistant(employerId: string, name: string): Promise<PersonaRow | null> {
  return upsertPatch(employerId, { assistant_name: name.slice(0, MAX_NAME_LENGTH) });
}

/** Store the employer's own display name, confirmed (or corrected) in the
 *  first voice session's onboarding exchange, and mark that exchange done so
 *  it never repeats. */
export async function setEmployerDisplayName(employerId: string, name: string): Promise<PersonaRow | null> {
  return upsertPatch(employerId, { employer_display_name: name.slice(0, MAX_NAME_LENGTH), voice_introduced: true });
}

/** The employer declined the proposed name (or the onboarding exchange ran
 *  without a usable name to propose) — mark the one-time exchange done
 *  without ever writing a display name. */
export async function markVoiceIntroduced(employerId: string): Promise<PersonaRow | null> {
  return upsertPatch(employerId, { voice_introduced: true });
}

export interface VoiceSettingsPatch {
  ttsVoice?: string | null;
  ttsRate?: number | null;
}

/** Per-account voice picker + rate, round-tripped so two sessions on the
 *  same account see the same values (Marvin's locked decision: settings are
 *  per account, server-stored, not per device). */
export async function setVoiceSettings(employerId: string, patch: VoiceSettingsPatch): Promise<PersonaRow | null> {
  const row: Record<string, unknown> = {};
  if (patch.ttsVoice !== undefined) row.tts_voice = patch.ttsVoice;
  if (patch.ttsRate !== undefined) row.tts_rate = patch.ttsRate;
  if (!Object.keys(row).length) return getOrCreatePersona(employerId);
  return upsertPatch(employerId, row);
}

/* --------------------------------------------------------------------- *
 * Deterministic text parsers — never an LLM call, by design. These run on
 * the raw user-typed text or STT transcript, in the route layer, BEFORE (or
 * instead of) any call into lib/assistant-chat.ts `runAssistantTurn`.
 * -------------------------------------------------------------------- */

const TRAILING_FILLER = /\s*[,]?\s*(please|thanks|thank you|ok|okay)\s*[.!]?\s*$/i;

/** Normalize a captured name fragment: strip trailing pleasantries and
 *  punctuation, cap length, and reject anything that isn't plausibly a name
 *  (letters, spaces, apostrophes, hyphens only) — a deterministic parser has
 *  no way to validate an arbitrary name, so this is a shape check, not a
 *  real-name check. */
export function cleanName(raw: string): string | null {
  let name = (raw || "").trim();
  name = name.replace(TRAILING_FILLER, "").trim();
  name = name.replace(/[.!?,;:]+$/g, "").trim();
  if (!name) return null;
  if (name.length > MAX_NAME_LENGTH) name = name.slice(0, MAX_NAME_LENGTH).trim();
  if (!/^[a-z][a-z' -]*$/i.test(name)) return null;
  return name;
}

const RENAME_PATTERNS: RegExp[] = [
  /\bcall you\s+(.+?)(?:[.,!?]|$)/i,
  /\byour name is\s+(.+?)(?:[.,!?]|$)/i,
  /\brename (?:you|yourself|the assistant)?\s*to\s+(.+?)(?:[.,!?]|$)/i,
];

/** "Call you X" / "Your name is X" / "Rename to X" — renames the ASSISTANT.
 *  Returns the cleaned name, or null if the text doesn't match any of the
 *  three supported phrasings. Works identically on typed text and an STT
 *  transcript — there is no separate voice-only grammar. */
export function parseRenameIntent(text: string): string | null {
  const t = (text || "").trim();
  if (!t) return null;
  for (const re of RENAME_PATTERNS) {
    const m = t.match(re);
    if (m && m[1]) {
      const name = cleanName(m[1]);
      if (name) return name;
    }
  }
  return null;
}

const CALL_ME_PATTERNS: RegExp[] = [
  /\bactually,?\s*call me\s+(.+?)(?:[.,!?]|$)/i,
  /\bcall me\s+(.+?)(?:[.,!?]|$)/i,
  /\bmy name is\s+(.+?)(?:[.,!?]|$)/i,
];

/** "Call me X" / "Actually call me X" / "My name is X" — corrects the
 *  EMPLOYER's own display name. Distinct pattern set from
 *  `parseRenameIntent` ("call YOU" renames the assistant; "call ME" renames
 *  the employer) — easy to conflate, so kept as two named functions rather
 *  than one parser with a direction flag. */
export function parseEmployerNameCorrection(text: string): string | null {
  const t = (text || "").trim();
  if (!t) return null;
  for (const re of CALL_ME_PATTERNS) {
    const m = t.match(re);
    if (m && m[1]) {
      const name = cleanName(m[1]);
      if (name) return name;
    }
  }
  return null;
}

const AFFIRM_RE = /^(yes|yeah|yep|yup|sure|ok|okay|fine|sounds good|that'?s right|correct|go ahead)\W*$/i;
const DECLINE_RE = /^(no|nope|nah|not really|no thanks)\W*$/i;

export interface NameConfirmationResult {
  accepted: boolean;
  /** Present only when the employer corrected the proposed name instead of
   *  simply accepting it (e.g. "Actually, call me Maria"). */
  correctedName?: string;
}

/** The employer's reply to the onboarding question ("Mind if I call you
 *  X?"). Returns null for anything that doesn't deterministically parse as
 *  yes/no/a correction — the caller treats that as "no usable answer yet",
 *  never as a decline. */
export function parseNameConfirmation(text: string): NameConfirmationResult | null {
  const t = (text || "").trim();
  if (!t) return null;
  const corrected = parseEmployerNameCorrection(t);
  if (corrected) return { accepted: true, correctedName: corrected };
  if (AFFIRM_RE.test(t)) return { accepted: true };
  if (DECLINE_RE.test(t)) return { accepted: false };
  return null;
}
