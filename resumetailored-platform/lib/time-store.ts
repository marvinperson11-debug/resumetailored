import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  isReviewStatus,
  isAvailabilityKind,
  isTimeOffKind,
  isTimeOffStatus,
  type TimeEntry,
  type TimesheetReview,
  type ReviewStatus,
  type Shift,
  type AvailabilitySlot,
  type AvailabilityKind,
  type TimeOffRequest,
  type TimeOffKind,
  type TimeOffStatus,
} from "./time-hub";

/**
 * Time features persistence (Phase 2) — clock entries, weekly timesheet reviews,
 * shifts, availability and time-off requests. Every table is owner-scoped by
 * employer_id (Clerk user id, TEXT), same service-role pattern as the other
 * employer stores; best-effort (unconfigured/unreachable Supabase resolves to
 * empty reads / null writes, never a throw).
 */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

/* ───────────────────────────── Time clock ───────────────────────────── */

const ENTRY_COLS = "id, employee_id, clock_in, clock_out, note, created_at";

function mapEntry(r: Record<string, unknown>): TimeEntry {
  return {
    id: r.id as number,
    employeeId: r.employee_id as number,
    clockIn: (r.clock_in as string) || "",
    clockOut: (r.clock_out as string) || null,
    note: (r.note as string) || "",
    createdAt: (r.created_at as string) || "",
  };
}

/** The employee's currently-open entry (clocked in, not out), or null. */
export async function getOpenEntry(employerId: string, employeeId: number): Promise<TimeEntry | null> {
  const c = db();
  if (!c || !employerId || !employeeId) return null;
  try {
    const { data } = await c
      .from("time_entries")
      .select(ENTRY_COLS)
      .eq("employer_id", employerId)
      .eq("employee_id", employeeId)
      .is("clock_out", null)
      .order("clock_in", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? mapEntry(data) : null;
  } catch {
    return null;
  }
}

/** Clock in. No-op-safe: returns the existing open entry if already clocked in. */
export async function clockIn(employerId: string, employeeId: number, note: string): Promise<TimeEntry | null> {
  const c = db();
  if (!c || !employerId || !employeeId) return null;
  const open = await getOpenEntry(employerId, employeeId);
  if (open) return open;
  try {
    const { data, error } = await c
      .from("time_entries")
      .insert({ employer_id: employerId, employee_id: employeeId, note: (note || "").trim().slice(0, 500) || null })
      .select(ENTRY_COLS)
      .single();
    if (error || !data) {
      console.error("[clockIn]", error);
      return null;
    }
    return mapEntry(data);
  } catch (e) {
    console.error("[clockIn]", e);
    return null;
  }
}

/** Clock out the employee's open entry (optionally appending/replacing a note). */
export async function clockOut(employerId: string, employeeId: number, note?: string): Promise<TimeEntry | null> {
  const c = db();
  if (!c || !employerId || !employeeId) return null;
  const open = await getOpenEntry(employerId, employeeId);
  if (!open) return null;
  const patch: Record<string, unknown> = { clock_out: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (typeof note === "string" && note.trim()) patch.note = note.trim().slice(0, 500);
  try {
    const { data, error } = await c
      .from("time_entries")
      .update(patch)
      .eq("employer_id", employerId)
      .eq("id", open.id)
      .select(ENTRY_COLS)
      .single();
    if (error || !data) return null;
    return mapEntry(data);
  } catch {
    return null;
  }
}

/** Entries for one employee whose clock-in falls within [weekStart, weekStart+7d). */
export async function listEntriesForWeek(employerId: string, employeeId: number, weekStart: string): Promise<TimeEntry[]> {
  const c = db();
  if (!c || !employerId || !employeeId || !weekStart) return [];
  const endExclusive = addDays(weekStart, 7);
  try {
    const { data } = await c
      .from("time_entries")
      .select(ENTRY_COLS)
      .eq("employer_id", employerId)
      .eq("employee_id", employeeId)
      .gte("clock_in", `${weekStart}T00:00:00Z`)
      .lt("clock_in", `${endExclusive}T00:00:00Z`)
      .order("clock_in", { ascending: true })
      .limit(500);
    return (data || []).map(mapEntry);
  } catch {
    return [];
  }
}

/** Recent entries for one employee (most recent first) — the employee's own log. */
export async function listRecentEntries(employerId: string, employeeId: number, limit = 50): Promise<TimeEntry[]> {
  const c = db();
  if (!c || !employerId || !employeeId) return [];
  try {
    const { data } = await c
      .from("time_entries")
      .select(ENTRY_COLS)
      .eq("employer_id", employerId)
      .eq("employee_id", employeeId)
      .order("clock_in", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 500));
    return (data || []).map(mapEntry);
  } catch {
    return [];
  }
}

/* ─────────────────────────── Timesheet reviews ─────────────────────────── */

const REVIEW_COLS = "id, employee_id, week_start, status, note, reviewed_by, reviewed_at";

function mapReview(r: Record<string, unknown>): TimesheetReview {
  return {
    id: r.id as number,
    employeeId: r.employee_id as number,
    weekStart: (r.week_start as string) || "",
    status: (isReviewStatus(r.status) ? r.status : "pending") as ReviewStatus,
    note: (r.note as string) || "",
    reviewedBy: (r.reviewed_by as string) || null,
    reviewedAt: (r.reviewed_at as string) || null,
  };
}

/** The review row for one (employee, week), or null if never reviewed. */
export async function getReview(employerId: string, employeeId: number, weekStart: string): Promise<TimesheetReview | null> {
  const c = db();
  if (!c || !employerId || !employeeId || !weekStart) return null;
  try {
    const { data } = await c
      .from("timesheet_reviews")
      .select(REVIEW_COLS)
      .eq("employer_id", employerId)
      .eq("employee_id", employeeId)
      .eq("week_start", weekStart)
      .maybeSingle();
    return data ? mapReview(data) : null;
  } catch {
    return null;
  }
}

/** All reviews for a week, across employees. */
export async function listReviewsForWeek(employerId: string, weekStart: string): Promise<TimesheetReview[]> {
  const c = db();
  if (!c || !employerId || !weekStart) return [];
  try {
    const { data } = await c
      .from("timesheet_reviews")
      .select(REVIEW_COLS)
      .eq("employer_id", employerId)
      .eq("week_start", weekStart)
      .limit(2000);
    return (data || []).map(mapReview);
  } catch {
    return [];
  }
}

/** Set (upsert) the approve/decline decision for one (employee, week). */
export async function setReview(
  employerId: string,
  employeeId: number,
  weekStart: string,
  status: ReviewStatus,
  note: string,
  reviewedBy: string
): Promise<TimesheetReview | null> {
  const c = db();
  if (!c || !employerId || !employeeId || !weekStart) return null;
  const row = {
    employer_id: employerId,
    employee_id: employeeId,
    week_start: weekStart,
    status,
    note: (note || "").trim().slice(0, 1000) || null,
    reviewed_by: reviewedBy || null,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  try {
    const { data, error } = await c
      .from("timesheet_reviews")
      .upsert(row, { onConflict: "employer_id,employee_id,week_start" })
      .select(REVIEW_COLS)
      .single();
    if (error || !data) {
      console.error("[setReview]", error);
      return null;
    }
    return mapReview(data);
  } catch (e) {
    console.error("[setReview]", e);
    return null;
  }
}

/** The employee flags a week ready for review — an explicit signal so the
 *  employer's bell has something to fire on, distinct from "hours happen to
 *  exist for this week." Never resets an already-approved week; resubmitting
 *  after a decline (or before any review exists) sets it back to pending. */
export async function submitTimesheet(employerId: string, employeeId: number, weekStart: string): Promise<TimesheetReview | null> {
  const c = db();
  if (!c || !employerId || !employeeId || !weekStart) return null;
  const existing = await getReview(employerId, employeeId, weekStart);
  if (existing && existing.status === "approved") return existing;
  try {
    const { data, error } = await c
      .from("timesheet_reviews")
      .upsert(
        { employer_id: employerId, employee_id: employeeId, week_start: weekStart, status: "pending", updated_at: new Date().toISOString() },
        { onConflict: "employer_id,employee_id,week_start" }
      )
      .select(REVIEW_COLS)
      .single();
    if (error || !data) return null;
    return mapReview(data);
  } catch (e) {
    console.error("[submitTimesheet]", e);
    return null;
  }
}

/* ───────────────────────────────── Shifts ───────────────────────────────── */

const SHIFT_COLS = "id, employee_id, shift_date, start_time, end_time, note, published";

function mapShift(r: Record<string, unknown>): Shift {
  return {
    id: r.id as number,
    employeeId: r.employee_id as number,
    shiftDate: (r.shift_date as string) || "",
    startTime: (r.start_time as string) || "",
    endTime: (r.end_time as string) || "",
    note: (r.note as string) || "",
    published: !!r.published,
  };
}

/** All shifts (published or not) in a week — the employer's grid. */
export async function listShiftsForWeek(employerId: string, weekStart: string): Promise<Shift[]> {
  const c = db();
  if (!c || !employerId || !weekStart) return [];
  const endExclusive = addDays(weekStart, 7);
  try {
    const { data } = await c
      .from("shifts")
      .select(SHIFT_COLS)
      .eq("employer_id", employerId)
      .gte("shift_date", weekStart)
      .lt("shift_date", endExclusive)
      .order("shift_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(2000);
    return (data || []).map(mapShift);
  } catch {
    return [];
  }
}

/** An employee's PUBLISHED shifts from `fromDate` (YYYY-MM-DD) onward. */
export async function listPublishedShiftsForEmployee(employerId: string, employeeId: number, fromDate: string): Promise<Shift[]> {
  const c = db();
  if (!c || !employerId || !employeeId) return [];
  try {
    const { data } = await c
      .from("shifts")
      .select(SHIFT_COLS)
      .eq("employer_id", employerId)
      .eq("employee_id", employeeId)
      .eq("published", true)
      .gte("shift_date", fromDate)
      .order("shift_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(500);
    return (data || []).map(mapShift);
  } catch {
    return [];
  }
}

export interface ShiftInput {
  employeeId: number;
  shiftDate: string;
  startTime: string;
  endTime: string;
  note?: string;
}

/** Create a shift (unpublished). Validation is the caller's job. */
export async function createShift(employerId: string, input: ShiftInput): Promise<Shift | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const { data, error } = await c
      .from("shifts")
      .insert({
        employer_id: employerId,
        employee_id: input.employeeId,
        shift_date: input.shiftDate,
        start_time: input.startTime,
        end_time: input.endTime,
        note: (input.note || "").trim().slice(0, 300) || null,
      })
      .select(SHIFT_COLS)
      .single();
    if (error || !data) {
      console.error("[createShift]", error);
      return null;
    }
    return mapShift(data);
  } catch (e) {
    console.error("[createShift]", e);
    return null;
  }
}

/** Update a shift's times/note (kept owner-scoped by employer_id). */
export async function updateShift(
  employerId: string,
  id: number,
  patch: Partial<Pick<ShiftInput, "startTime" | "endTime" | "note" | "shiftDate">>
): Promise<Shift | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.startTime) row.start_time = patch.startTime;
  if (patch.endTime) row.end_time = patch.endTime;
  if (patch.shiftDate) row.shift_date = patch.shiftDate;
  if (patch.note !== undefined) row.note = (patch.note || "").trim().slice(0, 300) || null;
  try {
    const { data, error } = await c.from("shifts").update(row).eq("employer_id", employerId).eq("id", id).select(SHIFT_COLS).single();
    if (error || !data) return null;
    return mapShift(data);
  } catch {
    return null;
  }
}

/** Delete a shift, returning the row as it was just before deletion (so the
 *  caller can tell whether it was live/published, and who to notify). */
export async function deleteShift(employerId: string, id: number): Promise<Shift | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data, error } = await c.from("shifts").delete().eq("employer_id", employerId).eq("id", id).select(SHIFT_COLS).maybeSingle();
    if (error) return null;
    return data ? mapShift(data) : null;
  } catch {
    return null;
  }
}

/** Publish every shift in a week (draft → visible to employees). Returns the
 *  number of newly-published shifts, or null on failure. */
export interface PublishResult {
  count: number;
  employeeIds: number[];
}

export async function publishWeek(employerId: string, weekStart: string): Promise<PublishResult | null> {
  const c = db();
  if (!c || !employerId || !weekStart) return null;
  const endExclusive = addDays(weekStart, 7);
  try {
    const { data, error } = await c
      .from("shifts")
      .update({ published: true, updated_at: new Date().toISOString() })
      .eq("employer_id", employerId)
      .eq("published", false)
      .gte("shift_date", weekStart)
      .lt("shift_date", endExclusive)
      .select("id, employee_id");
    if (error) return null;
    const rows = data || [];
    return { count: rows.length, employeeIds: Array.from(new Set(rows.map((r) => r.employee_id as number))) };
  } catch {
    return null;
  }
}

/* ──────────────────────────────── Availability ───────────────────────────── */

const AVAIL_COLS = "id, employee_id, kind, weekday, specific_date, start_time, end_time, available, note";

function mapAvail(r: Record<string, unknown>): AvailabilitySlot {
  return {
    id: r.id as number,
    employeeId: r.employee_id as number,
    kind: (isAvailabilityKind(r.kind) ? r.kind : "recurring") as AvailabilityKind,
    weekday: r.weekday === null || r.weekday === undefined ? null : (r.weekday as number),
    specificDate: (r.specific_date as string) || null,
    startTime: (r.start_time as string) || "",
    endTime: (r.end_time as string) || "",
    available: r.available === undefined ? true : !!r.available,
    note: (r.note as string) || "",
  };
}

/** One employee's availability slots. */
export async function listAvailability(employerId: string, employeeId: number): Promise<AvailabilitySlot[]> {
  const c = db();
  if (!c || !employerId || !employeeId) return [];
  try {
    const { data } = await c
      .from("availability")
      .select(AVAIL_COLS)
      .eq("employer_id", employerId)
      .eq("employee_id", employeeId)
      .order("kind", { ascending: true })
      .order("weekday", { ascending: true, nullsFirst: true })
      .order("specific_date", { ascending: true, nullsFirst: true })
      .limit(500);
    return (data || []).map(mapAvail);
  } catch {
    return [];
  }
}

/** Availability across the whole workforce — the employer's scheduling overlay. */
export async function listAvailabilityForEmployer(employerId: string): Promise<AvailabilitySlot[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data } = await c.from("availability").select(AVAIL_COLS).eq("employer_id", employerId).limit(5000);
    return (data || []).map(mapAvail);
  } catch {
    return [];
  }
}

export interface AvailabilityInput {
  kind: AvailabilityKind;
  weekday?: number | null;
  specificDate?: string | null;
  startTime: string;
  endTime: string;
  available?: boolean;
  note?: string;
}

/** Add an availability slot for an employee. */
export async function addAvailability(employerId: string, employeeId: number, input: AvailabilityInput): Promise<AvailabilitySlot | null> {
  const c = db();
  if (!c || !employerId || !employeeId) return null;
  try {
    const { data, error } = await c
      .from("availability")
      .insert({
        employer_id: employerId,
        employee_id: employeeId,
        kind: input.kind,
        weekday: input.kind === "recurring" ? input.weekday ?? null : null,
        specific_date: input.kind === "date" ? input.specificDate ?? null : null,
        start_time: input.startTime,
        end_time: input.endTime,
        available: input.available === undefined ? true : !!input.available,
        note: (input.note || "").trim().slice(0, 300) || null,
      })
      .select(AVAIL_COLS)
      .single();
    if (error || !data) {
      console.error("[addAvailability]", error);
      return null;
    }
    return mapAvail(data);
  } catch (e) {
    console.error("[addAvailability]", e);
    return null;
  }
}

/** Delete one of the employee's own availability slots. */
export async function deleteAvailability(employerId: string, employeeId: number, id: number): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !employeeId || !id) return false;
  try {
    const { error } = await c.from("availability").delete().eq("employer_id", employerId).eq("employee_id", employeeId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

/* ───────────────────────────── Time-off requests ──────────────────────────── */

const TIME_OFF_COLS =
  "id, employee_id, start_date, end_date, kind, reason, status, employer_note, reviewed_by, reviewed_at, created_at";

function mapTimeOff(r: Record<string, unknown>): TimeOffRequest {
  return {
    id: r.id as number,
    employeeId: r.employee_id as number,
    startDate: (r.start_date as string) || "",
    endDate: (r.end_date as string) || "",
    kind: (isTimeOffKind(r.kind) ? r.kind : "vacation") as TimeOffKind,
    reason: (r.reason as string) || "",
    status: (isTimeOffStatus(r.status) ? r.status : "pending") as TimeOffStatus,
    employerNote: (r.employer_note as string) || "",
    reviewedBy: (r.reviewed_by as string) || null,
    reviewedAt: (r.reviewed_at as string) || null,
    createdAt: (r.created_at as string) || "",
  };
}

export interface TimeOffInput {
  startDate: string;
  endDate: string;
  kind: TimeOffKind;
  reason?: string;
}

/** The employee files a request. */
export async function createTimeOff(employerId: string, employeeId: number, input: TimeOffInput): Promise<TimeOffRequest | null> {
  const c = db();
  if (!c || !employerId || !employeeId) return null;
  try {
    const { data, error } = await c
      .from("time_off_requests")
      .insert({
        employer_id: employerId,
        employee_id: employeeId,
        start_date: input.startDate,
        end_date: input.endDate,
        kind: input.kind,
        reason: (input.reason || "").trim().slice(0, 1000) || null,
      })
      .select(TIME_OFF_COLS)
      .single();
    if (error || !data) {
      console.error("[createTimeOff]", error);
      return null;
    }
    return mapTimeOff(data);
  } catch (e) {
    console.error("[createTimeOff]", e);
    return null;
  }
}

/** The employee's own requests, newest first. */
export async function listTimeOffForEmployee(employerId: string, employeeId: number): Promise<TimeOffRequest[]> {
  const c = db();
  if (!c || !employerId || !employeeId) return [];
  try {
    const { data } = await c
      .from("time_off_requests")
      .select(TIME_OFF_COLS)
      .eq("employer_id", employerId)
      .eq("employee_id", employeeId)
      .order("start_date", { ascending: false })
      .limit(500);
    return (data || []).map(mapTimeOff);
  } catch {
    return [];
  }
}

/** All requests for the employer, optionally filtered by status. */
export async function listTimeOffForEmployer(employerId: string, status?: TimeOffStatus): Promise<TimeOffRequest[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    let q = c.from("time_off_requests").select(TIME_OFF_COLS).eq("employer_id", employerId);
    if (status) q = q.eq("status", status);
    const { data } = await q.order("created_at", { ascending: false }).limit(2000);
    return (data || []).map(mapTimeOff);
  } catch {
    return [];
  }
}

/** Approved requests overlapping a week [weekStart, weekStart+7d) — the
 *  scheduling overlay. */
export async function listApprovedTimeOffForWeek(employerId: string, weekStart: string): Promise<TimeOffRequest[]> {
  const c = db();
  if (!c || !employerId || !weekStart) return [];
  const weekEnd = addDays(weekStart, 6); // inclusive last day (Sunday)
  try {
    const { data } = await c
      .from("time_off_requests")
      .select(TIME_OFF_COLS)
      .eq("employer_id", employerId)
      .eq("status", "approved")
      .lte("start_date", weekEnd)
      .gte("end_date", weekStart)
      .limit(2000);
    return (data || []).map(mapTimeOff);
  } catch {
    return [];
  }
}

/** Edit a request's date range (employer-side correction, e.g. from the
 *  schedule grid). Leaves status/kind/reason untouched. */
export async function updateTimeOffDates(
  employerId: string,
  id: number,
  input: { startDate: string; endDate: string }
): Promise<TimeOffRequest | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data, error } = await c
      .from("time_off_requests")
      .update({
        start_date: input.startDate,
        end_date: input.endDate,
        updated_at: new Date().toISOString(),
      })
      .eq("employer_id", employerId)
      .eq("id", id)
      .select(TIME_OFF_COLS)
      .single();
    if (error || !data) return null;
    return mapTimeOff(data);
  } catch {
    return null;
  }
}

/** The employer approves/declines a request. */
export async function setTimeOffStatus(
  employerId: string,
  id: number,
  status: TimeOffStatus,
  note: string,
  reviewedBy: string
): Promise<TimeOffRequest | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data, error } = await c
      .from("time_off_requests")
      .update({
        status,
        employer_note: (note || "").trim().slice(0, 1000) || null,
        reviewed_by: reviewedBy || null,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("employer_id", employerId)
      .eq("id", id)
      .select(TIME_OFF_COLS)
      .single();
    if (error || !data) return null;
    return mapTimeOff(data);
  } catch {
    return null;
  }
}

/* ───────────────────────────────── helpers ──────────────────────────────── */
// Local date arithmetic (avoids importing the client bundle's copy). Kept in
// UTC to match time-hub's week maths.
function addDays(iso: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
