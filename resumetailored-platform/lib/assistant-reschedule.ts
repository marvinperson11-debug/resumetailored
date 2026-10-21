/**
 * Tokenized Reply-To for interview reminder emails (Employer Portal AI
 * Assistant — Prompt 3). The whole inbound-reply feature is off unless BOTH
 * `INBOUND_EMAIL_DOMAIN` and `INBOUND_WEBHOOK_SECRET` are set: empty env =
 * feature off, the existing plain-reply-to-the-employer path in
 * lib/interview-reminders.ts is kept, and a single warning is logged (see
 * `warnInboundNotConfiguredOnce`).
 *
 * The token is DERIVED, not stored-then-reused: `deriveToken(interviewId)` is
 * `HMAC(INBOUND_WEBHOOK_SECRET, "reschedule:" + interviewId)`, so the exact
 * same token comes out every time for a given interview without ever
 * persisting the plaintext anywhere. That matters because the 24h and 2h
 * reminder emails for the SAME interview must carry the SAME Reply-To (a
 * candidate may reply to either one), and a one-way hash can't be reversed to
 * recover a token to reuse. Deriving it instead means there is nothing secret
 * to store — `interviews.reschedule_token_hash` (migration 0054) is a
 * verification cache, not a capability: the inbound webhook could recompute
 * and compare `deriveToken` directly, but comparing against the stored hash
 * keeps the webhook path from needing `INBOUND_WEBHOOK_SECRET` logic
 * duplicated in two places and gives a natural place to invalidate a token
 * later (clear the column) without changing the secret for every interview.
 *
 * Uses the WEB CRYPTO global (`crypto.subtle`), not Node's `node:crypto` —
 * this module is imported by lib/interview-reminders.ts, which is reachable
 * from instrumentation.ts, which Next.js also compiles for the EDGE runtime;
 * `node:crypto` fails that compile ("UnhandledSchemeError: Reading from
 * 'node:crypto' is not handled"). `crypto.subtle` is a global in both the
 * edge runtime and Node 19+ (confirmed against this repo's actual `npm run
 * build`), so every exported function here is async.
 */

const LOCAL_PART_RE = /^resc-(\d+)-([a-f0-9]{16,64})@/i;

/** How long a token stays valid after the interview's own scheduled time —
 *  a reply window, not a security property (the HMAC itself never expires on
 *  its own). Bounds how long a stale reminder email can still be acted on. */
const TOKEN_VALID_DAYS = 30;

export function inboundEmailConfigured(): boolean {
  return !!(process.env.INBOUND_EMAIL_DOMAIN && process.env.INBOUND_WEBHOOK_SECRET);
}

let warned = false;
export function warnInboundNotConfiguredOnce(reason: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[assistant-reschedule] inbound email reply-to is disabled: ${reason}`);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return toHex(sig);
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return toHex(digest);
}

async function deriveToken(interviewId: number): Promise<string> {
  const secret = process.env.INBOUND_WEBHOOK_SECRET || "";
  const full = await hmacSha256Hex(secret, `reschedule:${interviewId}`);
  return full.slice(0, 32);
}

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/** The hash to store on `interviews.reschedule_token_hash` for this
 *  interview — recomputing and re-storing it on every reminder send is
 *  harmless (it's always the same value for the same interview + secret). */
export async function tokenHashForInterview(interviewId: number): Promise<string> {
  return hashToken(await deriveToken(interviewId));
}

/** The Reply-To address for a reminder email, or null when the feature isn't
 *  configured (caller falls back to the existing plain reply-to-employer
 *  address and should warn once). */
export async function rescheduleReplyTo(interviewId: number): Promise<string | null> {
  const domain = process.env.INBOUND_EMAIL_DOMAIN;
  if (!inboundEmailConfigured()) {
    warnInboundNotConfiguredOnce("INBOUND_EMAIL_DOMAIN or INBOUND_WEBHOOK_SECRET not set");
    return null;
  }
  return `resc-${interviewId}-${await deriveToken(interviewId)}@${domain}`;
}

export interface ParsedReplyAddress {
  interviewId: number;
  token: string;
}

/** Parse a `resc-{interviewId}-{token}@...` local part out of a raw address
 *  (which may be a bare address or a "Name <addr>" form). Returns null for
 *  anything that doesn't match the shape — the caller treats that exactly
 *  like an unknown token (404, no information disclosed). Pure/sync — no
 *  crypto needed just to parse. */
export function parseReplyAddress(address: string): ParsedReplyAddress | null {
  const m = /<([^>]+)>/.exec(address);
  const addr = (m ? m[1] : address).trim().toLowerCase();
  const parsed = LOCAL_PART_RE.exec(addr);
  if (!parsed) return null;
  const interviewId = Number(parsed[1]);
  if (!Number.isFinite(interviewId) || interviewId <= 0) return null;
  return { interviewId, token: parsed[2].toLowerCase() };
}

/** Verify a parsed token against the interview it claims to belong to:
 *  recomputed hash must match AND the interview's own schedule must still be
 *  within the reply window. Tamper (right id, wrong token) and staleness
 *  collapse to the same false — both are "unknown/expired" at the webhook. */
export async function isValidReplyToken(parsed: ParsedReplyAddress, storedHash: string | null, scheduledAtIso: string, now: number = Date.now()): Promise<boolean> {
  if (!storedHash) return false;
  const computed = await hashToken(parsed.token);
  if (computed !== storedHash) return false;
  const scheduledMs = new Date(scheduledAtIso).getTime();
  if (!Number.isFinite(scheduledMs)) return false;
  return now - scheduledMs <= TOKEN_VALID_DAYS * 24 * 60 * 60 * 1000;
}
