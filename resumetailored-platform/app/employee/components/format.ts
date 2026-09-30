import { addDaysISO, parseISODate } from "@/lib/time-hub";

/**
 * Locale-aware date/time formatting for the employee portal. `lib/time-hub`
 * hard-codes English ("Mon", "en-US", "9:00 AM") because it also feeds CSV
 * exports and the employer tabs; the portal renders through these helpers
 * instead, so dates, weekdays and clock times follow the viewer's language.
 * Dates are YYYY-MM-DD strings formatted in UTC so they never shift a day.
 */

/** Full weekday name for a YYYY-MM-DD date (or a 0–6 Sunday-based index). */
export function weekdayName(dateOrIndex: string | number, locale: string): string {
  const d = typeof dateOrIndex === "number" ? new Date(Date.UTC(2023, 0, 1 + dateOrIndex)) : parseISODate(dateOrIndex);
  return d ? d.toLocaleDateString(locale, { weekday: "long", timeZone: "UTC" }) : "";
}

/** "Jan 5" — month + day. */
export function shortDate(iso: string, locale: string): string {
  const d = parseISODate(iso);
  return d ? d.toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: "UTC" }) : iso;
}

/** One day, or "Jan 5 – Jan 9". */
export function dateRange(startIso: string, endIso: string, locale: string): string {
  return startIso === endIso ? shortDate(startIso, locale) : `${shortDate(startIso, locale)} – ${shortDate(endIso, locale)}`;
}

/** The week starting at `weekStart`, e.g. "Jan 5 – Jan 11, 2026". */
export function weekRange(weekStart: string, locale: string): string {
  const start = parseISODate(weekStart);
  const end = parseISODate(addDaysISO(weekStart, 6));
  if (!start || !end) return weekStart;
  const fmt = (d: Date, withYear = false) =>
    d.toLocaleDateString(locale, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end, true)}`;
}

/** "HH:MM" (24h, as stored) -> the locale's clock style. */
export function clockTime(hhmm: string, locale: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  return new Date(Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2]))).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** An ISO timestamp -> local time of day. */
export function timeOfDay(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}
