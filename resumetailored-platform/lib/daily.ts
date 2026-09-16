/**
 * Daily.co video client (Employer Portal — Video Interviews).
 *
 * Server-only. Raw `fetch` against the Daily REST API — no SDK, no new
 * dependency. `DAILY_API_KEY` never leaves the server. Every call is
 * best-effort: a missing key or an unreachable API resolves to null so the
 * scheduler can gracefully fall back to a manual meeting link.
 *
 * Env (manual step — add in Railway):
 *   DAILY_API_KEY          — required to create rooms / read recordings
 *   DAILY_WEBHOOK_SECRET   — optional; when set, the webhook verifies the
 *                            X-Webhook-Signature HMAC before acting.
 */
import crypto from "crypto";

const DAILY_API = "https://api.daily.co/v1";
// Control-plane calls (rooms, webhooks, recording metadata) use a short timeout
// so a slow/blocked Railway→api.daily.co egress can't hang a request past the
// Cloudflare→origin window (which surfaces as a 502 host error). Media downloads
// keep their own longer timeouts.
const DAILY_TIMEOUT_MS = 8000;

export function dailyApiKey(): string {
  return process.env.DAILY_API_KEY || "";
}
export function isDailyConfigured(): boolean {
  return !!dailyApiKey();
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${dailyApiKey()}`, "Content-Type": "application/json" };
}

export interface DailyRoom {
  url: string;
  name: string;
}

/**
 * Create a Daily room for an interview. Named `rt-{interviewId}`, public (anyone
 * with the link can join — fine for a 2-person interview), auto-expiring, with
 * cloud recording when requested/allowed. Returns null on any failure so the
 * caller can fall back to a manual link.
 */
export async function createRoom(args: {
  interviewId: number;
  expUnix: number;
  enableRecording: boolean;
}): Promise<DailyRoom | null> {
  if (!isDailyConfigured()) return null;
  const properties: Record<string, unknown> = {
    exp: args.expUnix,
    eject_at_room_exp: true,
    enable_prejoin_ui: true,
    max_participants: 2,
  };
  if (args.enableRecording) properties.enable_recording = "cloud";
  try {
    const res = await fetch(`${DAILY_API}/rooms`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: `rt-${args.interviewId}`, privacy: "public", properties }),
      signal: AbortSignal.timeout(DAILY_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[daily.createRoom]", res.status, await res.text().catch(() => ""));
      return null;
    }
    const d = (await res.json()) as { url?: string; name?: string };
    if (!d.url || !d.name) return null;
    return { url: d.url, name: d.name };
  } catch (e) {
    console.error("[daily.createRoom]", e);
    return null;
  }
}

/** Delete a room (best-effort — on cancel/delete). */
export async function deleteRoom(name: string): Promise<void> {
  if (!isDailyConfigured() || !name) return;
  try {
    await fetch(`${DAILY_API}/rooms/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: authHeaders(),
      signal: AbortSignal.timeout(DAILY_TIMEOUT_MS),
    });
  } catch (e) {
    console.error("[daily.deleteRoom]", e);
  }
}

export interface DailyRecording {
  id: string;
  roomName: string;
  sessionId: string;
}

/** Fetch a recording's metadata (room + session id, for transcript lookup). */
export async function getRecording(recordingId: string): Promise<DailyRecording | null> {
  if (!isDailyConfigured() || !recordingId) return null;
  try {
    const res = await fetch(`${DAILY_API}/recordings/${encodeURIComponent(recordingId)}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(DAILY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { id?: string; room_name?: string; mtgSessionId?: string; session_id?: string };
    return {
      id: d.id || recordingId,
      roomName: d.room_name || "",
      sessionId: d.mtgSessionId || d.session_id || "",
    };
  } catch (e) {
    console.error("[daily.getRecording]", e);
    return null;
  }
}

/** A short-lived download URL for a recording's mp4. */
export async function getRecordingDownloadLink(recordingId: string): Promise<string | null> {
  if (!isDailyConfigured() || !recordingId) return null;
  try {
    const res = await fetch(`${DAILY_API}/recordings/${encodeURIComponent(recordingId)}/access-link`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(DAILY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { download_link?: string; link?: string };
    return d.download_link || d.link || null;
  } catch (e) {
    console.error("[daily.getRecordingDownloadLink]", e);
    return null;
  }
}

/**
 * Best-effort transcript text for a session. Requires the Daily domain to have
 * transcription (Deepgram) enabled; returns null otherwise. Looks up the
 * transcript for the session, then downloads its text via an access link.
 */
export async function getTranscriptText(sessionId: string): Promise<string | null> {
  if (!isDailyConfigured() || !sessionId) return null;
  try {
    const listRes = await fetch(`${DAILY_API}/transcript?mtgSessionId=${encodeURIComponent(sessionId)}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(DAILY_TIMEOUT_MS),
    });
    if (!listRes.ok) return null;
    const list = (await listRes.json()) as { data?: { transcriptId?: string; id?: string }[] };
    const t = (list.data || [])[0];
    const transcriptId = t?.transcriptId || t?.id;
    if (!transcriptId) return null;

    const linkRes = await fetch(`${DAILY_API}/transcript/${encodeURIComponent(transcriptId)}/access-link`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(DAILY_TIMEOUT_MS),
    });
    if (!linkRes.ok) return null;
    const link = (await linkRes.json()) as { link?: string };
    if (!link.link) return null;

    const txtRes = await fetch(link.link, { signal: AbortSignal.timeout(20000) });
    if (!txtRes.ok) return null;
    const text = await txtRes.text();
    return text.trim() || null;
  } catch (e) {
    console.error("[daily.getTranscriptText]", e);
    return null;
  }
}

/** Download a URL into a Buffer (recording/transcript archival). */
export async function downloadToBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length ? buf : null;
  } catch (e) {
    console.error("[daily.downloadToBuffer]", e);
    return null;
  }
}

/**
 * Verify a Daily webhook signature. Daily signs `${timestamp}.${rawBody}` with
 * HMAC-SHA256 (base64) using the webhook's hmac secret. When no secret is
 * configured we accept (the endpoint still validates payload shape).
 */
export function verifyDailySignature(rawBody: string, timestamp: string | null, signature: string | null, secret: string): boolean {
  if (!secret) return true; // not configured → accept
  if (!timestamp || !signature) return false;
  try {
    const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Parse `rt-{id}` room name → interview id. */
export function interviewIdFromRoomName(roomName: string | null | undefined): number | null {
  const m = /^rt-(\d+)$/.exec(String(roomName || ""));
  return m ? Number(m[1]) : null;
}

// ── Webhook registration (admin one-time setup) ───────────────────────────────
// Daily's webhook endpoints are managed through the REST API (`/v1/webhooks`),
// not a dashboard Settings page on most accounts — hence the admin route that
// calls these.
export interface DailyWebhook {
  uuid: string;
  url: string;
  hmac?: string;
  state?: string;
  eventTypes?: string[];
}

function mapWebhook(w: Record<string, unknown>): DailyWebhook {
  return {
    uuid: String(w.uuid || w.id || ""),
    url: String(w.url || ""),
    hmac: w.hmac ? String(w.hmac) : undefined,
    state: w.state ? String(w.state) : undefined,
    eventTypes: (w.eventTypes as string[]) || (w.event_types as string[]) || undefined,
  };
}

/** List the Daily account's configured webhooks. `null` on failure. */
export async function listWebhooks(): Promise<DailyWebhook[] | null> {
  if (!isDailyConfigured()) return null;
  try {
    const res = await fetch(`${DAILY_API}/webhooks`, { headers: authHeaders(), signal: AbortSignal.timeout(DAILY_TIMEOUT_MS) });
    if (!res.ok) {
      console.error("[daily.listWebhooks]", res.status, await res.text().catch(() => ""));
      return null;
    }
    const d = (await res.json()) as unknown;
    const arr = Array.isArray(d) ? d : ((d as { data?: unknown[] }).data ?? []);
    return (arr as Record<string, unknown>[]).map(mapWebhook);
  } catch (e) {
    console.error("[daily.listWebhooks]", e);
    return null;
  }
}

/** Register a webhook endpoint. When `hmac` is given, Daily signs deliveries
 *  with it (so our verifier can use the same shared secret). */
export async function createWebhook(
  url: string,
  eventTypes: string[],
  hmac?: string
): Promise<DailyWebhook | { error: string }> {
  if (!isDailyConfigured()) return { error: "DAILY_API_KEY is not set." };
  try {
    const res = await fetch(`${DAILY_API}/webhooks`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ url, eventTypes, ...(hmac ? { hmac } : {}) }),
      signal: AbortSignal.timeout(DAILY_TIMEOUT_MS),
    });
    const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { error: String(d.info || d.error || `Daily returned ${res.status}`) };
    }
    return mapWebhook(d);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Daily request failed" };
  }
}
