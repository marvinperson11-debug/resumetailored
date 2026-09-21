/**
 * Time features (Phase 2) — shared types, constants and PURE helpers (no DB, no
 * network). Mirrors the `employee-hub.ts` convention: colocate the domain types
 * with their validators + the week/CSV maths so both the stores and the route
 * handlers import from one place. Everything here is raw-hours only — there is
 * deliberately no overtime, wage or accrual logic anywhere.
 */

// ── Weeks (Monday-anchored) ──────────────────────────────────────────────────
// A "week" is identified by its Monday, as a YYYY-MM-DD string in UTC. All week
// maths is done on UTC calendar dates so a clock-in near midnight never lands in
// the wrong week for one viewer and the right one for another.

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
/** Full names indexed 0=Sun..6=Sat to match the `availability.weekday` column. */
export const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Parse a YYYY-MM-DD string to a UTC Date at midnight, or null. */
export function parseISODate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format a Date as YYYY-MM-DD in UTC. */
export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The Monday (YYYY-MM-DD) of the week containing `date` (a Date or YYYY-MM-DD
 *  string; defaults to today). Monday-anchored: Sunday belongs to the week that
 *  just ended. */
export function weekStartISO(date: Date | string = new Date()): string {
  const base = typeof date === "string" ? parseISODate(date) ?? new Date() : date;
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow; // shift back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return toISODate(d);
}

/** Add `n` days to a YYYY-MM-DD string, returning YYYY-MM-DD. */
export function addDaysISO(iso: string, n: number): string {
  const d = parseISODate(iso) ?? new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return toISODate(d);
}

/** The seven YYYY-MM-DD dates Mon..Sun for a week identified by its Monday. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
}

/** Human label for a week, e.g. "Mar 3 – Mar 9, 2026". */
export function weekLabel(weekStart: string): string {
  const start = parseISODate(weekStart);
  if (!start) return weekStart;
  const end = parseISODate(addDaysISO(weekStart, 6))!;
  const fmt = (d: Date, withYear = false) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end, true)}`;
}

// ── Time clock ───────────────────────────────────────────────────────────────
export interface TimeEntry {
  id: number;
  employeeId: number;
  clockIn: string; // ISO timestamp
  clockOut: string | null; // ISO timestamp, null while open
  note: string;
  createdAt: string;
}

/** Elapsed hours for one entry (open entry measured to `now`). Raw decimal
 *  hours; the caller decides rounding for display. */
export function entryHours(entry: Pick<TimeEntry, "clockIn" | "clockOut">, now: number = Date.now()): number {
  const start = new Date(entry.clockIn).getTime();
  const end = entry.clockOut ? new Date(entry.clockOut).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 3_600_000;
}

/** Sum of hours across entries (open entries measured to `now`). */
export function sumHours(entries: Pick<TimeEntry, "clockIn" | "clockOut">[], now: number = Date.now()): number {
  return entries.reduce((acc, e) => acc + entryHours(e, now), 0);
}

/** Round hours to 2 decimals for display / CSV. */
export function roundHours(h: number): number {
  return Math.round(h * 100) / 100;
}

/** "7h 30m" style compact duration from decimal hours. */
export function formatHM(h: number): string {
  const total = Math.max(0, Math.round(h * 60));
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  if (hh && mm) return `${hh}h ${mm}m`;
  if (hh) return `${hh}h`;
  return `${mm}m`;
}

// ── Timesheets (per employee, per week) ──────────────────────────────────────
export const REVIEW_STATUSES = ["pending", "approved", "declined"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const isReviewStatus = (v: unknown): v is ReviewStatus => (REVIEW_STATUSES as readonly string[]).includes(String(v));

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
};
export const REVIEW_TONE: Record<ReviewStatus, "gold" | "teal" | "red"> = {
  pending: "gold",
  approved: "teal",
  declined: "red",
};

export interface TimesheetReview {
  id: number;
  employeeId: number;
  weekStart: string;
  status: ReviewStatus;
  note: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

/** One employee's timesheet for a week: the entries plus the (optional) review
 *  decision and the summed hours. */
export interface WeekTimesheet {
  weekStart: string;
  entries: TimeEntry[];
  totalHours: number;
  review: TimesheetReview | null;
}

/**
 * CSV for a set of per-employee weekly timesheets. Raw hours only. One row per
 * (employee, day) that has hours, plus a per-employee total row — flat enough
 * for a spreadsheet import. Values are CSV-escaped.
 */
export interface CSVEmployeeWeek {
  employeeName: string;
  employeeEmail: string;
  weekStart: string;
  status: ReviewStatus;
  entries: Pick<TimeEntry, "clockIn" | "clockOut">[];
}
export function buildTimesheetCSV(rows: CSVEmployeeWeek[], now: number = Date.now()): string {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out: string[] = ["Employee,Email,Week starting,Date,Clock in,Clock out,Hours,Status"];
  const fmtTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) : "";
  for (const r of rows) {
    // Bucket entries by their clock-in UTC date.
    const byDay = new Map<string, Pick<TimeEntry, "clockIn" | "clockOut">[]>();
    for (const e of r.entries) {
      const day = e.clockIn.slice(0, 10);
      (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(e);
    }
    const days = Array.from(byDay.keys()).sort();
    let weekTotal = 0;
    for (const day of days) {
      for (const e of byDay.get(day)!) {
        const h = roundHours(entryHours(e, now));
        weekTotal += h;
        out.push(
          [r.employeeName, r.employeeEmail, r.weekStart, day, fmtTime(e.clockIn), fmtTime(e.clockOut), h, REVIEW_STATUS_LABELS[r.status]]
            .map(esc)
            .join(",")
        );
      }
    }
    out.push([r.employeeName, r.employeeEmail, r.weekStart, "TOTAL", "", "", roundHours(weekTotal), REVIEW_STATUS_LABELS[r.status]].map(esc).join(","));
  }
  return out.join("\n");
}

// ── Shifts (schedule) ────────────────────────────────────────────────────────
export interface Shift {
  id: number;
  employeeId: number;
  shiftDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  note: string;
  published: boolean;
}

/** Validate a 24h "HH:MM" time string. */
export function isHHMM(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** Minutes from midnight for an HH:MM string (NaN if invalid). */
export function hhmmToMinutes(v: string): number {
  if (!isHHMM(v)) return NaN;
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

/** Friendly "9:00 AM" from HH:MM. */
export function formatHHMM(v: string): string {
  if (!isHHMM(v)) return v;
  const [h, m] = v.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${period}`;
}

/** Decimal hours spanned by a shift (0 if invalid or end ≤ start). */
export function shiftHours(s: Pick<Shift, "startTime" | "endTime">): number {
  const a = hhmmToMinutes(s.startTime);
  const b = hhmmToMinutes(s.endTime);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0;
  return (b - a) / 60;
}

// ── Availability ─────────────────────────────────────────────────────────────
export const AVAILABILITY_KINDS = ["recurring", "date"] as const;
export type AvailabilityKind = (typeof AVAILABILITY_KINDS)[number];
export const isAvailabilityKind = (v: unknown): v is AvailabilityKind =>
  (AVAILABILITY_KINDS as readonly string[]).includes(String(v));

export interface AvailabilitySlot {
  id: number;
  employeeId: number;
  kind: AvailabilityKind;
  weekday: number | null; // 0=Sun..6=Sat, for recurring
  specificDate: string | null; // YYYY-MM-DD, for date-specific
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  available: boolean;
  note: string;
}

/** Label for a slot's day, e.g. "Mondays" (recurring) or "Mar 5" (date). */
export function availabilityDayLabel(slot: Pick<AvailabilitySlot, "kind" | "weekday" | "specificDate">): string {
  if (slot.kind === "date" && slot.specificDate) {
    const d = parseISODate(slot.specificDate);
    return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : slot.specificDate;
  }
  if (slot.weekday !== null && slot.weekday >= 0 && slot.weekday <= 6) return `${DOW_LABELS[slot.weekday]}s`;
  return "—";
}

// ── Time-off requests ────────────────────────────────────────────────────────
export const TIME_OFF_KINDS = ["vacation", "sick", "other"] as const;
export type TimeOffKind = (typeof TIME_OFF_KINDS)[number];
export const isTimeOffKind = (v: unknown): v is TimeOffKind => (TIME_OFF_KINDS as readonly string[]).includes(String(v));
export const TIME_OFF_KIND_LABELS: Record<TimeOffKind, string> = {
  vacation: "Vacation",
  sick: "Sick",
  other: "Other",
};

export const TIME_OFF_STATUSES = ["pending", "approved", "declined"] as const;
export type TimeOffStatus = (typeof TIME_OFF_STATUSES)[number];
export const isTimeOffStatus = (v: unknown): v is TimeOffStatus => (TIME_OFF_STATUSES as readonly string[]).includes(String(v));
export const TIME_OFF_STATUS_LABELS: Record<TimeOffStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
};
export const TIME_OFF_TONE: Record<TimeOffStatus, "gold" | "teal" | "red"> = {
  pending: "gold",
  approved: "teal",
  declined: "red",
};

export interface TimeOffRequest {
  id: number;
  employeeId: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  kind: TimeOffKind;
  reason: string;
  status: TimeOffStatus;
  employerNote: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** Inclusive-day count of a request's range (min 1). */
export function timeOffDays(r: Pick<TimeOffRequest, "startDate" | "endDate">): number {
  const a = parseISODate(r.startDate);
  const b = parseISODate(r.endDate);
  if (!a || !b) return 1;
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  return days < 1 ? 1 : days;
}

/** Whether an (approved) time-off range covers a given YYYY-MM-DD. */
export function timeOffCoversDate(r: Pick<TimeOffRequest, "startDate" | "endDate">, iso: string): boolean {
  return r.startDate <= iso && iso <= r.endDate;
}

/** Friendly range label, e.g. "Mar 5" (single day) or "Mar 5 – Mar 8". */
export function timeOffRangeLabel(r: Pick<TimeOffRequest, "startDate" | "endDate">): string {
  const fmt = (iso: string) => {
    const d = parseISODate(iso);
    return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : iso;
  };
  return r.startDate === r.endDate ? fmt(r.startDate) : `${fmt(r.startDate)} – ${fmt(r.endDate)}`;
}
