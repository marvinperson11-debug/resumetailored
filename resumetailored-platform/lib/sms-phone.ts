/**
 * Phone normalization + SMS segment counting. Pure, no DB/network — unit
 * tested directly in scripts/test-sms-bgc.cjs.
 */

/** US/Canada-only normalizer (the only numbers Twilio provisions for this
 *  build — "one US local number per org", no international scope). Accepts
 *  10-digit, 11-digit with a leading 1, or an already-E.164 `+1XXXXXXXXXX`
 *  string; strips everything else. Returns null when the digits don't form
 *  a plausible NANP number. */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, "");
  let national = digits;
  if (digits.length === 11 && digits.startsWith("1")) national = digits.slice(1);
  if (national.length !== 10) return null;
  if (!/^[2-9]\d{9}$/.test(national)) return null; // NANP: area code can't start with 0/1
  return `+1${national}`;
}

/** The 3-digit NANP area code from an E.164 `+1XXXXXXXXXX` string, or null. */
export function areaCodeOf(e164: string | null | undefined): string | null {
  if (!e164 || !/^\+1\d{10}$/.test(e164)) return null;
  return e164.slice(2, 5);
}

const GSM7_RE =
  /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘÆæßÉ!"#$%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;

/** True when every character in `text` is encodable in the GSM-7 alphabet
 *  (ASCII-ish + a handful of accented Latin/Greek letters). Anything outside
 *  it (CJK, emoji, most non-Latin scripts) forces UCS-2 encoding, which
 *  halves the per-segment character budget. */
export function isGsm7(text: string): boolean {
  return GSM7_RE.test(text);
}

export interface SegmentCount {
  /** Number of SMS segments the carrier will bill for this body. */
  segments: number;
  encoding: "GSM-7" | "UCS-2";
  /** Characters already used in the final (possibly partial) segment. */
  charsUsed: number;
  /** Per-segment character budget for this encoding/part-count. */
  perSegment: number;
}

/** Twilio/carrier segment math: single-part budgets are 160 (GSM-7) / 70
 *  (UCS-2); a message that needs more than one part loses a few characters
 *  per part to the concatenation header, dropping the budget to 153 / 67. */
export function countSegments(text: string): SegmentCount {
  const len = text.length;
  const gsm = isGsm7(text);
  const singleBudget = gsm ? 160 : 70;
  const multiBudget = gsm ? 153 : 67;
  if (len === 0) return { segments: 1, encoding: gsm ? "GSM-7" : "UCS-2", charsUsed: 0, perSegment: singleBudget };
  if (len <= singleBudget) return { segments: 1, encoding: gsm ? "GSM-7" : "UCS-2", charsUsed: len, perSegment: singleBudget };
  const segments = Math.ceil(len / multiBudget);
  const charsUsed = len - (segments - 1) * multiBudget;
  return { segments, encoding: gsm ? "GSM-7" : "UCS-2", charsUsed, perSegment: multiBudget };
}
