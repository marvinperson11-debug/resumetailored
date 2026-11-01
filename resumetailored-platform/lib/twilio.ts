/**
 * Twilio Programmable Messaging client. Server-only, raw REST over `fetch`
 * — no `twilio` npm SDK, same "no new dependency" convention as
 * lib/docusign.ts. One US local number per org (TWILIO_* env has no per-org
 * secret; the org-specific fact is just the phone number, stored in
 * `sms_numbers`).
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_STATUS_CALLBACK_URL
 * (optional override — defaults to this app's own status webhook).
 */
import crypto from "crypto";
import { appUrl } from "./subdomain";

export function isTwilioConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

function auth(): { sid: string; token: string } | null {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  if (!sid || !token) return null;
  return { sid, token };
}

function basicAuthHeader(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

export interface TwilioSendResult {
  ok: boolean;
  sid?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** Send one SMS. `statusCallbackUrl` defaults to our own status webhook so
 *  delivery receipts flow back without per-call configuration. */
export async function sendSmsViaTwilio(opts: { from: string; to: string; body: string; statusCallbackUrl?: string }): Promise<TwilioSendResult> {
  const creds = auth();
  if (!creds) return { ok: false, errorMessage: "twilio_not_configured" };
  const statusCallback = opts.statusCallbackUrl || process.env.TWILIO_STATUS_CALLBACK_URL || appUrl("/api/webhooks/twilio-status-webhook");
  const body = new URLSearchParams({ From: opts.from, To: opts.to, Body: opts.body, StatusCallback: statusCallback });
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: basicAuthHeader(creds.sid, creds.token), "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, errorCode: String(data.code || res.status), errorMessage: String(data.message || "send_failed") };
    return { ok: true, sid: data.sid as string, status: data.status as string };
  } catch (e) {
    return { ok: false, errorMessage: e instanceof Error ? e.message : "network_error" };
  }
}

export interface ProvisionedNumber {
  ok: boolean;
  phoneNumber?: string;
  sid?: string;
  errorMessage?: string;
}

/** Search for and buy one local US number, optionally biased toward an area
 *  code (best-effort hint; Twilio may not have inventory there, in which
 *  case the search drops the hint and falls back to any US local number). */
export async function provisionLocalNumber(areaCode?: string): Promise<ProvisionedNumber> {
  const creds = auth();
  if (!creds) return { ok: false, errorMessage: "twilio_not_configured" };
  try {
    const candidate = await findAvailableNumber(creds, areaCode);
    if (!candidate) return { ok: false, errorMessage: "no_numbers_available" };
    const purchaseBody = new URLSearchParams({
      PhoneNumber: candidate,
      SmsUrl: process.env.TWILIO_MESSAGING_WEBHOOK_URL || appUrl("/api/webhooks/twilio-inbound-webhook"),
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/IncomingPhoneNumbers.json`, {
      method: "POST",
      headers: { Authorization: basicAuthHeader(creds.sid, creds.token), "Content-Type": "application/x-www-form-urlencoded" },
      body: purchaseBody.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, errorMessage: String(data.message || "purchase_failed") };
    return { ok: true, phoneNumber: data.phone_number as string, sid: data.sid as string };
  } catch (e) {
    return { ok: false, errorMessage: e instanceof Error ? e.message : "network_error" };
  }
}

async function findAvailableNumber(creds: { sid: string; token: string }, areaCode?: string): Promise<string | null> {
  const qs = new URLSearchParams({ Limit: "1" });
  if (areaCode) qs.set("AreaCode", areaCode);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/AvailablePhoneNumbers/US/Local.json?${qs.toString()}`, {
    headers: { Authorization: basicAuthHeader(creds.sid, creds.token) },
  });
  const data = (await res.json().catch(() => ({}))) as { available_phone_numbers?: { phone_number: string }[] };
  const first = data.available_phone_numbers?.[0]?.phone_number;
  if (first) return first;
  if (areaCode) return findAvailableNumber(creds, undefined); // retry with no area-code hint
  return null;
}

/**
 * Validate Twilio's `X-Twilio-Signature` header: base64(HMAC-SHA1(authToken,
 * url + sorted "key"+"value" params concatenated)), per Twilio's own
 * request-validation spec. `url` must be the exact, publicly-reachable URL
 * Twilio was configured to POST to (scheme + host + path, no query string
 * unless Twilio was given one) — a mismatch here is the #1 cause of
 * signature validation silently always failing.
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

/** Parse a Twilio `application/x-www-form-urlencoded` webhook body into a
 *  flat string map (every Twilio webhook param is a plain string). */
export function parseTwilioForm(raw: string): Record<string, string> {
  const params = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  params.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}
