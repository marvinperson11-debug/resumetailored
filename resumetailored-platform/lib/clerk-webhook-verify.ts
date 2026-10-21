import crypto from "crypto";

/**
 * Svix signature verification for the platform's own Clerk webhook endpoint
 * (app/api/webhooks/clerk-welcome, Welcome Email build). Clerk signs its
 * webhook deliveries with Svix, the same scheme Resend uses — this is a
 * deliberate, self-contained duplicate of lib/assistant-resend-inbound.ts's
 * verification helpers (same HMAC-SHA256-over-`{id}.{timestamp}.{body}`,
 * same 5-minute skew tolerance, same multi-candidate `v1,<sig>` parsing)
 * rather than importing from that file: the two webhooks are unrelated
 * features (Employer Portal AI Assistant vs. account welcome emails) that
 * happen to share a signing vendor, and keeping them decoupled means a
 * change to one's dedupe/claim logic can't accidentally ripple into the
 * other's auth path. No new dependency — Clerk's own `svix` npm package is
 * intentionally not added here, per this build's "no new npm dependencies"
 * constraint.
 *
 * Uses Node's `crypto`, not Web Crypto: this module is only ever imported
 * from app/api/webhooks/clerk-welcome/route.ts, which declares
 * `export const runtime = "nodejs"`, never from instrumentation.ts's
 * edge-compiled graph.
 */

const SVIX_TOLERANCE_SECONDS = 5 * 60;

export interface SvixHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

/** Reads the three Svix headers off a request; null if any are missing —
 *  the caller treats that as "not a validly Svix-signed delivery" and
 *  answers 401 rather than guessing at an alternate auth scheme. */
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

/** HMAC-SHA256 of `{id}.{timestamp}.{raw body}` under the base64-decoded
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
