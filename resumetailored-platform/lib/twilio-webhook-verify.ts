import "server-only";
import crypto from "crypto";

/**
 * Validate Twilio's `X-Twilio-Signature` header: base64(HMAC-SHA1(authToken,
 * url + sorted "key"+"value" params concatenated)), per Twilio's own
 * request-validation spec. `url` must be the exact, publicly-reachable URL
 * Twilio was configured to POST to (scheme + host + path, no query string
 * unless Twilio was given one) — a mismatch here is the #1 cause of
 * signature validation silently always failing.
 *
 * Split out of lib/twilio.ts so the client (sendSmsViaTwilio etc., used by
 * lib/sms-queue-flush.ts, which instrumentation.ts dynamically imports) has
 * no `node:crypto` import of its own — only the webhook route handlers
 * (always `runtime = "nodejs"`) import this module. `server-only` makes an
 * accidental client import a build-time error rather than a runtime one.
 */
export function verifyTwilioSignature(url: string, params: Record<string, string>, signatureHeader: string | null, authToken: string): boolean {
  if (!signatureHeader || !authToken) return false;
  try {
    const sorted = Object.keys(params).sort();
    let data = url;
    for (const key of sorted) data += key + params[key];
    const expected = crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
