/**
 * Employer local-time helpers — zero dependencies (no Supabase, no date
 * library; just `Date` and `Intl`), so this file is safe to import from
 * anywhere, including the edge-compiled graph instrumentation.ts pulls in
 * (lib/interview-reminders.ts, lib/assistant-brief.ts — see their own header
 * comments on why a stray import can break `npm run build`).
 *
 * There is no per-employer timezone preference stored anywhere in the schema
 * yet, so `getEmployerTimezone` resolves to one process-wide default
 * (`EMPLOYER_TIMEZONE`, falling back to America/New_York) — the `employerId`
 * parameter exists so a future per-employer preference can be wired in here
 * without changing any call site.
 *
 * Fixes the defect where a candidate's "Oct 24 10am" reply, or an employer's
 * "today", was parsed/computed as if it were UTC (an EDT time off by 4-5
 * hours; a UTC day boundary that doesn't match the employer's actual
 * morning). Every wall-clock <-> UTC conversion and every "today" boundary
 * the Employer Portal AI Assistant computes should go through this file.
 */

export const DEFAULT_EMPLOYER_TIMEZONE = "America/New_York";

/** The employer's timezone for display/parsing — currently one process-wide
 *  default; `employerId` is accepted (and ignored) for forward compatibility
 *  with a future per-employer preference. */
export async function getEmployerTimezone(_employerId: string): Promise<string> {
  const tz = (process.env.EMPLOYER_TIMEZONE || "").trim();
  return tz || DEFAULT_EMPLOYER_TIMEZONE;
}

/** The UTC offset (in minutes; e.g. -240 for EDT, -300 for EST) `tz`
 *  observes at `utcMs` — the standard `formatToParts` trick: format `utcMs`
 *  IN `tz`, re-read those wall-clock numbers as if they were themselves UTC,
 *  and the gap between that reinterpretation and `utcMs` is the offset. No
 *  date library needed, and it's DST-correct because the formatter itself
 *  knows the zone's rules for this particular instant. */
function offsetMinutesAt(tz: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asIfUtc - utcMs) / 60000);
}

/** Converts a NAIVE local wall-clock date-time (no "Z", no offset — e.g.
 *  "2026-10-24T10:00:00") that means a moment IN `tz` into the real UTC
 *  instant it refers to, correctly across a DST transition. Two passes: an
 *  initial guess treating the naive string as UTC, then a correction using
 *  the offset `tz` actually observes AT that guessed instant (and one more
 *  correction if that still disagrees — the only way the guess can land on
 *  the wrong side of a transition). Throws on an unparseable input so a
 *  caller never silently schedules against `NaN`. */
export function wallClockToUtc(naiveLocalDateTime: string, tz: string): string {
  const raw = naiveLocalDateTime.trim();
  const guessMs = Date.parse(/[zZ]$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`);
  if (!Number.isFinite(guessMs)) throw new Error(`wallClockToUtc: unparseable date/time "${naiveLocalDateTime}"`);
  const offset1 = offsetMinutesAt(tz, guessMs);
  let utcMs = guessMs - offset1 * 60000;
  const offset2 = offsetMinutesAt(tz, utcMs);
  if (offset2 !== offset1) utcMs = guessMs - offset2 * 60000;
  return new Date(utcMs).toISOString();
}

/** Renders an instant in `tz`, e.g. "Sat, Oct 24, 2026, 10:00 AM EDT" — the
 *  one display format every employer-facing card/notification should use
 *  instead of a raw UTC string. Returns the raw input (stringified) if it
 *  doesn't parse as a date, same fail-soft behavior as the UTC-only
 *  formatter this replaces. */
export function formatEmployerTime(ts: string | number, tz: string): string {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return typeof ts === "string" ? ts : String(ts);
  const base = d.toLocaleString("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const zoneName = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName")?.value;
  return zoneName ? `${base} ${zoneName}` : base;
}

/** The hour-of-day (0-23) it is in `tz` at `atUtcMs` — the local equivalent
 *  of `new Date(atUtcMs).getUTCHours()`. */
export function localHourInTz(atUtcMs: number, tz: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(atUtcMs)));
}

/** The UTC instant of local midnight (00:00:00) in `tz`, for the local
 *  calendar day containing `atUtcMs`. The single source every "today"
 *  boundary in the Employer Portal AI Assistant should be computed from,
 *  instead of `setUTCHours(0,0,0,0)` (which is midnight in the SERVER's
 *  timezone, i.e. UTC — not the employer's). */
export function startOfDayInTz(atUtcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(atUtcMs))) parts[p.type] = p.value;
  return Date.parse(wallClockToUtc(`${parts.year}-${parts.month}-${parts.day}T00:00:00`, tz));
}

/** [start, end) of the local calendar day containing `atUtcMs`, in `tz`. */
export function dayRangeInTz(atUtcMs: number, tz: string): { startMs: number; endMs: number } {
  const startMs = startOfDayInTz(atUtcMs, tz);
  return { startMs, endMs: startMs + 24 * 60 * 60 * 1000 };
}
