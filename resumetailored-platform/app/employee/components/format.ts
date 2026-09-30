import { addDaysISO } from "@/lib/time-hub";
import {
  formatDate,
  formatDateRange,
  formatTime,
  weekdayName as weekdayNameByIndex,
} from "@/lib/format";

/**
 * Employee-portal date/time helpers — thin wrappers over `lib/format` (all
 * `Intl.DateTimeFormat` with the viewer's locale), kept so the portal's call
 * sites stay short. `lib/time-hub` stays English because it also feeds CSV
 * export and AI prompts; the portal never displays its labels.
 */

/** Full weekday name for a YYYY-MM-DD date (or a 0–6 Sunday-based index). */
export function weekdayName(dateOrIndex: string | number, locale: string): string {
  return typeof dateOrIndex === "number" ? weekdayNameByIndex(dateOrIndex, locale) : formatDate(dateOrIndex, locale, "weekdayLong");
}

/** "Jan 5" — month + day. */
export function shortDate(iso: string, locale: string): string {
  return formatDate(iso, locale, "monthDay", iso);
}

/** One day, or a locale-written range ("Jan 5 – 9, 2026"). */
export function dateRange(startIso: string, endIso: string, locale: string): string {
  return formatDateRange(startIso, endIso, locale, `${startIso} – ${endIso}`);
}

/** The 7-day week starting at `weekStart`. */
export function weekRange(weekStart: string, locale: string): string {
  return formatDateRange(weekStart, addDaysISO(weekStart, 6), locale, weekStart);
}

/** "HH:MM" (24h, as stored) -> the locale's clock style. */
export function clockTime(hhmm: string, locale: string): string {
  return formatTime(hhmm, locale, hhmm);
}

/** An ISO timestamp -> local time of day. */
export function timeOfDay(iso: string, locale: string): string {
  return formatTime(iso, locale);
}

/** A full calendar date ("Jan 5, 2026"); falls back to the raw value. */
export function fullDate(iso: string, locale: string): string {
  return formatDate(iso, locale, "medium", iso);
}
