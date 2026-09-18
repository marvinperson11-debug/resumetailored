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
}): Promise<(DailyRoom & { recordingEnabled: boolean }) | null> {
  if (!isDailyConfigured()) return null;
  const properties: Record<string, unknown> = {
    exp: args.expUnix,
    eject_at_room_exp: true,
    enable_prejoin_ui: true,
    max_participants: 2,
    // Screen sharing for presenting docs/slides or a browser tab. The prebuilt
    // UI shows the Share button when this is on; sharing a Chrome tab "with
    // audio" (to play a short video to the candidate) is a browser-side option
    // in that share dialog — no extra room property needed.
    enable_screenshare: true,
  };
  if (args.enableRecording) properties.enable_recording = "cloud";
  const reqBody = { name: `rt-${args.interviewId}`, privacy: "public", properties };
  // Log exactly what we send so recording config is auditable at schedule time.
  console.log("[daily.createRoom] request", JSON.stringify(reqBody));
  try {
    const res = await fetch(`${DAILY_API}/rooms`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(DAILY_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[daily.createRoom]", res.status, await res.text().catch(() => ""));
      return null;
    }
    const d = (await res.json()) as { url?: string; name?: string; config?: Record<string, unknown> };
    // Log what Daily accepted — `config.enable_recording` confirms recording is
    // permitted on the room (note: this only PERMITS recording; auto-start needs
    // a meeting token with start_cloud_recording — see createMeetingToken).
    // Surface enable_screenshare explicitly (as well as the full config) so the
    // log confirms screen sharing is on for newly created rooms at a glance.
    const recordingEnabled = d.config?.enable_recording === "cloud";
    console.log("[daily.createRoom] response", JSON.stringify({ name: d.name, url: d.url, enable_recording: d.config?.enable_recording, recordingEnabled, requestedRecording: args.enableRecording, enable_screenshare: d.config?.enable_screenshare, config: d.config }));
    if (!d.url || !d.name) return null;
    return { url: d.url, name: d.name, recordingEnabled };
  } catch (e) {
    console.error("[daily.createRoom]", e);
    return null;
  }
}

/**
 * Mint a Daily meeting token for a room. When `startCloudRecording` is set (and
 * the room has enable_recording:'cloud'), cloud recording AUTO-STARTS the moment
 * this token's holder joins — which is the only reliable way to record a
 * server-created room that has no interactive "Record" click. `is_owner` gives
 * the holder recording control in the prebuilt UI. Returns null on any failure
 * so the caller can fall back to the plain (un-recorded) room URL.
 */
export async function createMeetingToken(args: {
  roomName: string;
  expUnix: number;
  isOwner?: boolean;
  startCloudRecording?: boolean;
}): Promise<string | null> {
  if (!isDailyConfigured() || !args.roomName) return null;
  const properties: Record<string, unknown> = { room_name: args.roomName, exp: args.expUnix };
  if (args.isOwner) {
    properties.is_owner = true;
    properties.enable_screenshare = true; // host can present / share a tab
  }
  if (args.startCloudRecording) {
    // Both are required: the token must also carry enable_recording:'cloud'.
    properties.enable_recording = "cloud";
    properties.start_cloud_recording = true;
  }
  console.log("[daily.createMeetingToken] request", JSON.stringify({ room_name: args.roomName, is_owner: !!args.isOwner, start_cloud_recording: !!args.startCloudRecording }));
  try {
    const res = await fetch(`${DAILY_API}/meeting-tokens`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ properties }),
      signal: AbortSignal.timeout(DAILY_TIMEOUT_MS),
    });
    const d = (await res.json().catch(() => ({}))) as { token?: string; error?: string; info?: string };
    if (!res.ok || !d.token) {
      console.error("[daily.createMeetingToken] non-ok", res.status, d.info || d.error || "");
      return null;
    }
    console.log("[daily.createMeetingToken] minted", JSON.stringify({ room_name: args.roomName, start_cloud_recording: !!args.startCloudRecording }));
    return d.token;
  } catch (e) {
    console.error("[daily.createMeetingToken] threw", e);
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
 * HMAC-SHA256 (base64) using the webhook's hmac secret — where the key is the
 * DECODED bytes of the base64 `hmac` we registered. We register
 * base64(trimmed DAILY_WEBHOOK_SECRET) (see createWebhook), so those decoded
 * bytes are exactly the trimmed secret's utf8 bytes — i.e. the HMAC key here is
 * the trimmed secret used directly. One scheme, both sides. The trim also drops
 * any trailing newline that crept into the env value. No secret ⇒ accept (the
 * endpoint still validates payload shape).
 */
export function verifyDailySignature(rawBody: string, timestamp: string | null, signature: string | null, secret: string): boolean {
  const key = (secret || "").trim();
  if (!key) return true; // not configured → accept
  if (!timestamp || !signature) return false;
  try {
    const expected = crypto.createHmac("sha256", key).update(`${timestamp}.${rawBody}`, "utf8").digest("base64");
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
    const err = e as { name?: string; message?: string; cause?: { code?: string } };
    // Same classification as createWebhook — AbortError (our 8s timeout) vs
    // DNS (ENOTFOUND/EAI_AGAIN) vs egress (ECONNREFUSED/ETIMEDOUT/UND_ERR_*).
    console.error("[daily.listWebhooks] threw", err?.name, err?.cause?.code, err?.message);
    return null;
  }
}

/** Register a webhook endpoint. When `hmac` is given, Daily signs deliveries
 *  with it (so our verifier can use the same shared secret).
 *
 *  Daily requires the `hmac` field to be a VALID BASE64 STRING (it decodes it to
 *  the signing-key bytes), and rejects a plain string with HTTP 400
 *  ("\"hmac\" must be a valid base64 string"). So we base64-encode the trimmed
 *  secret here — the operator's DAILY_WEBHOOK_SECRET can be any string. The
 *  matching decode/verify side is verifyDailySignature (which uses the trimmed
 *  secret directly as the key = the decoded bytes). The trim also drops any
 *  trailing newline that crept into the env value. */
export async function createWebhook(
  url: string,
  eventTypes: string[],
  hmac?: string
): Promise<DailyWebhook | { error: string }> {
  if (!isDailyConfigured()) return { error: "DAILY_API_KEY is not set." };
  const hmacB64 = hmac ? Buffer.from(hmac.trim(), "utf8").toString("base64") : undefined;
  try {
    const res = await fetch(`${DAILY_API}/webhooks`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ url, eventTypes, ...(hmacB64 ? { hmac: hmacB64 } : {}) }),
      signal: AbortSignal.timeout(DAILY_TIMEOUT_MS),
    });
    const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const detail = String(d.info || d.error || `Daily returned ${res.status}`);
      // Log the Daily-side reason so a 5xx here is diagnosable (plan-gated?
      // bad event type? auth?) — the route returns it too, but the server log
      // is the record when the response is masked by an upstream proxy.
      console.error("[daily.createWebhook] non-ok", res.status, detail, JSON.stringify(d).slice(0, 500));
      return { error: `${detail} (HTTP ${res.status})` };
    }
    return mapWebhook(d);
  } catch (e) {
    const err = e as { name?: string; message?: string; cause?: { code?: string } };
    // Classify the transport failure: AbortError = our timeout fired;
    // ENOTFOUND/EAI_AGAIN = DNS; ECONNREFUSED/ETIMEDOUT/UND_ERR_* = egress.
    console.error("[daily.createWebhook] threw", err?.name, err?.cause?.code, err?.message);
    const code = err?.cause?.code ? ` ${err.cause.code}` : "";
    return { error: `${err?.name || "Error"}${code}: ${err?.message || "Daily request failed"}` };
  }
}
