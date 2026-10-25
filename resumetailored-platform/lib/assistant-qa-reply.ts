/**
 * Tokenized Reply-To for Candidate Q&A (Prompt 6, Section 1) — the "existing
 * inbound email path" the spec rides on only actually recognizes ONE
 * address shape before this file: `resc-{interviewId}-{token}@...`
 * (lib/assistant-reschedule.ts), tied to a single scheduled interview. A
 * candidate question is about a JOB they applied to, not necessarily an
 * interview that exists yet, so this is a second, parallel address shape —
 * `faq-{jobId}-{applicantId}-{token}@...` — recognized by
 * lib/assistant-inbound.ts `processInboundReschedule` alongside the
 * reschedule shape (same route, same webhook, same auth — see that file's
 * header for why "inbound email path" means ONE dispatcher trying both
 * shapes rather than a second route).
 *
 * Same derive-don't-store design as assistant-reschedule.ts, simplified:
 * there is no revocation requirement for this token (disabling Q&A for a job
 * is a separate, independent switch — job_faqs.enabled — so there is nothing
 * for clearing a stored hash to accomplish), so the token is recomputed and
 * compared directly with no stored-hash indirection. Uses the WEB CRYPTO
 * global for the identical reason assistant-reschedule.ts does: this module
 * is reachable from lib/assistant-ack-worker.ts and lib/assistant-send-worker.ts,
 * both ticked from instrumentation.ts's edge-compiled graph, where
 * `node:crypto` fails the build.
 */

const LOCAL_PART_RE = /^faq-(\d+)-(\d+)-([a-f0-9]{16,64})@/i;

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

async function deriveQaToken(jobId: number, applicantId: number): Promise<string> {
  const secret = process.env.INBOUND_WEBHOOK_SECRET || "";
  const full = await hmacSha256Hex(secret, `qa:${jobId}:${applicantId}`);
  return full.slice(0, 32);
}

export function qaInboundConfigured(): boolean {
  return !!(process.env.INBOUND_EMAIL_DOMAIN && process.env.INBOUND_WEBHOOK_SECRET);
}

/** The Reply-To address for a candidate-facing email on a Q&A-enabled job,
 *  or null when the feature isn't configured (caller falls back to its
 *  existing reply-to-the-employer address). */
export async function qaReplyTo(jobId: number, applicantId: number): Promise<string | null> {
  if (!qaInboundConfigured()) return null;
  const domain = process.env.INBOUND_EMAIL_DOMAIN;
  return `faq-${jobId}-${applicantId}-${await deriveQaToken(jobId, applicantId)}@${domain}`;
}

export interface ParsedQaReplyAddress {
  jobId: number;
  applicantId: number;
  token: string;
}

/** Parse a `faq-{jobId}-{applicantId}-{token}@...` local part out of a raw
 *  address. Null for anything that doesn't match — the caller falls through
 *  to the reschedule shape, then to "unknown token" if neither matches. */
export function parseQaReplyAddress(address: string): ParsedQaReplyAddress | null {
  const m = /<([^>]+)>/.exec(address);
  const addr = (m ? m[1] : address).trim().toLowerCase();
  const parsed = LOCAL_PART_RE.exec(addr);
  if (!parsed) return null;
  const jobId = Number(parsed[1]);
  const applicantId = Number(parsed[2]);
  if (!Number.isFinite(jobId) || jobId <= 0 || !Number.isFinite(applicantId) || applicantId <= 0) return null;
  return { jobId, applicantId, token: parsed[3].toLowerCase() };
}

/** Verify a parsed token by recomputing it — no staleness window (unlike the
 *  reschedule token, this one isn't tied to a single scheduled instant). */
export async function isValidQaReplyToken(parsed: ParsedQaReplyAddress): Promise<boolean> {
  const expected = await deriveQaToken(parsed.jobId, parsed.applicantId);
  return expected === parsed.token;
}
