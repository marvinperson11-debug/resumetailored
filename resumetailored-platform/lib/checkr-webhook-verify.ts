import "server-only";
import crypto from "crypto";

/**
 * Checkr signs webhooks as HMAC-SHA256(secret, rawBody), hex-encoded, in
 * `X-Checkr-Signature`. Fails closed (false) with no secret configured.
 *
 * Split out of lib/checkr.ts so the client (createCheckrCandidate etc.) has
 * no `node:crypto` import of its own — only the webhook route handler
 * (`runtime = "nodejs"`) imports this module. lib/checkr.ts is not currently
 * reachable from any edge-compiled graph (it's only imported from
 * lib/bgc-store.ts, itself only imported from `runtime = "nodejs"` API
 * routes), but this keeps it that way defensively, matching the same
 * extraction already done for lib/twilio.ts. `server-only` makes an
 * accidental client import a build-time error rather than a runtime one.
 */
export function verifyCheckrSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  try {
    const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
