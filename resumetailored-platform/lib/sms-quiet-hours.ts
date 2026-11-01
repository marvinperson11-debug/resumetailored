/**
 * Quiet-hours approximation: no candidate-facing sends 9pm-8am in the
 * recipient's LOCAL time, approximated from their NANP area code (the spec
 * calls for "area-code approximation", not a real geolocation lookup, which
 * would need a paid lookup API this build doesn't have). Pure, no DB/network.
 *
 * Coverage is representative, not exhaustive: one area code per US/Canada
 * timezone bucket that quiet-hours math actually cares about (Eastern,
 * Central, Mountain, Pacific, plus Alaska/Hawaii) is enough to prove the
 * logic; an area code this map doesn't recognize falls back to Eastern —
 * the earliest US timezone, which makes the 9pm-8am window the MOST
 * conservative (most likely to flag "quiet") for an unknown number, never
 * the least.
 */
import { areaCodeOf } from "./sms-phone";

export type NanpTimeZone = "America/New_York" | "America/Chicago" | "America/Denver" | "America/Los_Angeles" | "America/Anchorage" | "Pacific/Honolulu";

const AREA_CODE_TIMEZONE: Record<string, NanpTimeZone> = {
  // Eastern
  "212": "America/New_York", "718": "America/New_York", "646": "America/New_York", "917": "America/New_York",
  "617": "America/New_York", "202": "America/New_York", "305": "America/New_York", "404": "America/New_York",
  "215": "America/New_York", "412": "America/New_York", "313": "America/New_York", "614": "America/New_York",
  "704": "America/New_York", "843": "America/New_York", "954": "America/New_York",
  // Central
  "312": "America/Chicago", "773": "America/Chicago", "214": "America/Chicago", "713": "America/Chicago",
  "512": "America/Chicago", "615": "America/Chicago", "901": "America/Chicago", "314": "America/Chicago",
  "816": "America/Chicago", "504": "America/Chicago", "605": "America/Chicago", "316": "America/Chicago",
  // Mountain
  "303": "America/Denver", "505": "America/Denver", "602": "America/Denver", "801": "America/Denver",
  "406": "America/Denver", "520": "America/Denver",
  // Pacific
  "213": "America/Los_Angeles", "310": "America/Los_Angeles", "415": "America/Los_Angeles", "510": "America/Los_Angeles",
  "619": "America/Los_Angeles", "503": "America/Los_Angeles", "206": "America/Los_Angeles", "702": "America/Los_Angeles",
  "775": "America/Los_Angeles",
  // Alaska / Hawaii
  "907": "America/Anchorage",
  "808": "Pacific/Honolulu",
};

const DEFAULT_TZ: NanpTimeZone = "America/New_York";

export function timezoneForPhone(e164: string | null | undefined): NanpTimeZone {
  const area = areaCodeOf(e164);
  return (area && AREA_CODE_TIMEZONE[area]) || DEFAULT_TZ;
}

function localHour(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).formatToParts(at);
  const h = parts.find((p) => p.type === "hour")?.value;
  const n = h ? Number(h) : at.getUTCHours();
  return n === 24 ? 0 : n;
}

export const QUIET_HOURS_START = 21; // 9pm local
export const QUIET_HOURS_END = 8; // 8am local

/** True when `at` (default now) falls in the recipient's local 9pm-8am window. */
export function isQuietHours(e164: string | null | undefined, at: Date = new Date()): boolean {
  const tz = timezoneForPhone(e164);
  const hour = localHour(tz, at);
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}

/** The next moment (UTC) at which sending resumes — today's or tomorrow's
 *  8am local, expressed as a UTC Date. Walks forward in 15-minute steps
 *  (bounded to 24h) rather than doing timezone-offset arithmetic by hand,
 *  so it stays correct across DST transitions for the recipient's zone. */
export function nextSendWindow(e164: string | null | undefined, at: Date = new Date()): Date {
  if (!isQuietHours(e164, at)) return at;
  const tz = timezoneForPhone(e164);
  let cursor = new Date(at.getTime());
  for (let i = 0; i < 24 * 4; i++) {
    cursor = new Date(cursor.getTime() + 15 * 60 * 1000);
    if (localHour(tz, cursor) === QUIET_HOURS_END) return cursor;
  }
  return cursor;
}
