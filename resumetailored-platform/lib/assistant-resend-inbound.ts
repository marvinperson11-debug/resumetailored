import crypto from "crypto";

/**
 * Resend-specific inbound-email adapter (Employer Portal AI Assistant,
 * Prompt 4). Resend's webhook delivers METADATA ONLY
 * ({type:"email.received", data:{email_id, from, to, subject}}) — no body —
 * so this module (1) verifies the delivery's Svix-style signature, (2)
 * fetches the full message by `email_id` from Resend's own API, (3) strips a
 * quoted-reply tail, and (4) maps the result into the SAME
 * `InboundEmailPayload` shape lib/assistant-inbound.ts has always consumed.
 * The reschedule/stop/unknown classification logic in that file is
 * completely untouched by this adapter — see
 * app/api/webhooks/inbound-email/route.ts for how the two are wired
 * together.
 *
 * Uses Node's `crypto` (not Web Crypto, unlike lib/assistant-reschedule.ts)
 * because this module is only ever imported from
 * app/api/webhooks/inbound-email/route.ts, which already declares
 * `export const runtime = "nodejs"` — never from instrumentation.ts's
 * edge-compiled graph, so there is no edge-runtime constraint to honor here.
 */

const SVIX_TOLERANCE_SECONDS = 5 * 60;

export interface SvixHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

/** Reads the three Svix headers off a request; null if any are missing — the
 *  caller treats that as "not a Svix-signed delivery" and falls back to the
 *  legacy shared-secret path (so an unrelated/older provider's webhook,
 *  which never sends these, is unaffected by this adapter existing). */
export function readSvixHeaders(headers: Headers): SvixHeaders | null {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return null;
  return { id, timestamp, signature };
}

function decodeSvixSecret(secret: string): Buffer {
  const b64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(b64, "base64");
}

/** Svix signature verification (the scheme Resend's webhooks use):
 *  HMAC-SHA256 of `{id}.{timestamp}.{raw body}` under the base64-decoded
 *  signing secret, base64-encoded, compared against any `v1,<sig>` entry in
 *  the space-separated svix-signature header — Svix sends multiple versions
 *  during a secret rotation, so any one matching is valid. Constant-time
 *  comparison per candidate. */
export function verifySvixSignature(secret: string, headers: SvixHeaders, rawBody: string): boolean {
  if (!secret) return false;
  let key: Buffer;
  try {
    key = decodeSvixSecret(secret);
  } catch {
    return false;
  }
  const signedContent = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", key).update(signedContent, "utf8").digest("base64");
  const expectedBuf = Buffer.from(expected);
  const candidates = headers.signature
    .split(" ")
    .map((p) => p.split(",")[1])
    .filter((v): v is string => !!v);
  return candidates.some((c) => {
    const candBuf = Buffer.from(c);
    return candBuf.length === expectedBuf.length && crypto.timingSafeEqual(candBuf, expectedBuf);
  });
}

/** Rejects a timestamp more than 5 minutes away from now, in either
 *  direction — both a replayed old delivery and a clock far enough off to
 *  not be trustworthy. */
export function isStaleSvixTimestamp(timestampSeconds: string, now: number = Date.now()): boolean {
  const ts = Number(timestampSeconds);
  if (!Number.isFinite(ts)) return true;
  return Math.abs(Math.floor(now / 1000) - ts) > SVIX_TOLERANCE_SECONDS;
}

export interface ResendReceivedEnvelope {
  emailId: string;
}

/** Resend's webhook body is metadata only. Returns null for anything that
 *  isn't exactly `{type:"email.received", data:{email_id: string, ...}}` —
 *  the route answers 400 for that ("unknown envelope"), distinct from an
 *  auth failure, and discloses nothing about which part didn't match. */
export function parseResendEnvelope(body: unknown): ResendReceivedEnvelope | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.type !== "email.received") return null;
  const data = b.data;
  if (!data || typeof data !== "object") return null;
  const emailId = (data as Record<string, unknown>).email_id;
  if (typeof emailId !== "string" || !emailId.trim()) return null;
  return { emailId: emailId.trim() };
}

export interface ResendFetchedEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** GET the full received message by id — the webhook delivery itself carries
 *  no body, only metadata and an id to look it up. Plain `fetch`, no SDK
 *  (the codebase's standing rule for this feature — see
 *  lib/assistant-inbound.ts's own header comment). Null on ANY failure
 *  (missing key, network error, non-2xx, unexpected shape) — the caller
 *  treats that the same as "could not process this delivery".
 *
 *  NOTE: this sandbox had no outbound network access to verify Resend's
 *  "retrieve a received email" endpoint path live against their current API
 *  reference — confirm `RESEND_RECEIVING_API_BASE`'s default against
 *  https://resend.com/docs before relying on this in production; override
 *  the env var if the real path differs. */
export async function fetchResendReceivedEmail(emailId: string): Promise<ResendFetchedEmail | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !emailId) return null;
  const base = process.env.RESEND_RECEIVING_API_BASE || "https://api.resend.com/emails/receiving";
  try {
    const res = await fetch(`${base}/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data) return null;
    const from = typeof data.from === "string" ? data.from : "";
    const to = typeof data.to === "string" ? data.to : Array.isArray(data.to) ? String(data.to[0] || "") : "";
    const subject = typeof data.subject === "string" ? data.subject : "";
    const rawText = typeof data.text === "string" ? data.text : "";
    const text = rawText.trim() ? rawText : htmlToText(typeof data.html === "string" ? data.html : "");
    if (!from || !to) return null;
    return { from, to, subject, text };
  } catch {
    return null;
  }
}

/** Strip a quoted-reply tail at the first line that looks like a mail
 *  client's quote delimiter — "On <date>, <name> wrote:" (Gmail / Apple Mail
 *  / most clients' default quote header) or a bare "From:" line (Outlook's
 *  plain-text quote style) — keeping everything before it. No delimiter
 *  found means the whole text is the reply; nothing is stripped. */
const QUOTE_DELIMITER_RE = /^(On .{0,120} wrote:|-{2,}\s*Original Message\s*-{2,}.*|From:\s*.+)$/im;
export function stripQuotedReply(text: string): string {
  const m = QUOTE_DELIMITER_RE.exec(text);
  if (!m) return text.trim();
  return text.slice(0, m.index).trim();
}
