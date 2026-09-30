import { formatDate } from "./format";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ChartPoint, ChartSource, HiringActivityData, TimesheetSummaryData, TrainingComplianceData, ReportDateRange } from "./office-hub";
import { listEmployees } from "./employees-store";
import { listApplicants, listJobs } from "./employer-store";
import { listEntriesForWeek } from "./time-store";
import { sumHours, weekStartISO, roundHours, entryHours, addDaysISO } from "./time-hub";
import { listAllAcknowledgments, listTrainingDocs } from "./training-store";
import { complianceState } from "./employee-hub";

/**
 * Office suite persistence: live chart data sources (built from the platform's
 * own stores — nothing new to persist for these) + the office-assets bucket
 * upload for "Insert into a document" + the Report Writer's three data
 * gatherers (Phase 5). Same service-role pattern as the other employer stores.
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

/** "Applicants over time" — one point per of the last 14 days. */
async function applicantsOverTime(employerId: string, locale: string): Promise<ChartPoint[]> {
  const applicants = await listApplicants(employerId);
  const days: string[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const counts = new Map(days.map((d) => [d, 0]));
  for (const a of applicants) {
    const day = (a.createdAt || "").slice(0, 10);
    if (counts.has(day)) counts.set(day, (counts.get(day) || 0) + 1);
  }
  return days.map((d) => ({
    label: formatDate(d, locale, "monthDay"),
    value: counts.get(d) || 0,
  }));
}

/** "Timesheet hours per employee" — the current calendar week's clocked hours. */
async function timesheetHoursPerEmployee(employerId: string): Promise<ChartPoint[]> {
  const employees = (await listEmployees(employerId)).filter((e) => e.status !== "offboarded");
  const weekStart = weekStartISO();
  const points: ChartPoint[] = [];
  for (const e of employees) {
    const entries = await listEntriesForWeek(employerId, e.id, weekStart);
    points.push({ label: e.name || `Employee #${e.id}`, value: roundHours(sumHours(entries)) });
  }
  return points;
}

/** "Training completion %" — signed/waived acknowledgments ÷ total assigned,
 *  per active employee, across all training docs. */
async function trainingCompletionPerEmployee(employerId: string): Promise<ChartPoint[]> {
  const [employees, acks] = await Promise.all([
    listEmployees(employerId).then((rows) => rows.filter((e) => e.status !== "offboarded")),
    listAllAcknowledgments(employerId),
  ]);
  const byEmployee = new Map<number, { done: number; total: number }>();
  for (const a of acks) {
    const bucket = byEmployee.get(a.employeeId) || { done: 0, total: 0 };
    bucket.total += 1;
    const state = complianceState(a);
    if (state === "signed" || state === "waived") bucket.done += 1;
    byEmployee.set(a.employeeId, bucket);
  }
  return employees.map((e) => {
    const bucket = byEmployee.get(e.id);
    const pct = bucket && bucket.total > 0 ? Math.round((bucket.done / bucket.total) * 100) : 0;
    return { label: e.name || `Employee #${e.id}`, value: pct };
  });
}

export async function chartDataForSource(employerId: string, source: ChartSource, locale = "en"): Promise<ChartPoint[]> {
  if (!employerId) return [];
  try {
    if (source === "applicants") return await applicantsOverTime(employerId, locale);
    if (source === "timesheet") return await timesheetHoursPerEmployee(employerId);
    if (source === "training") return await trainingCompletionPerEmployee(employerId);
    return [];
  } catch (e) {
    console.error("[chartDataForSource]", e);
    return [];
  }
}

// ── office-assets (public bucket) ───────────────────────────────────────────
const OFFICE_ASSET_BUCKET = "office-assets";

/** Upload a chart PNG into the employer's own folder of the PUBLIC
 *  office-assets bucket and return its public URL — an inserted chart is
 *  embedded as an <img> in a Document Creator document, which needs an
 *  unauthenticated URL to render. */
export async function uploadOfficeChartPng(employerId: string, png: Buffer): Promise<{ url: string; path: string } | null> {
  const c = db();
  if (!c || !employerId) return null;
  const path = `${employerId}/${Date.now()}-chart.png`;
  try {
    const { error } = await c.storage.from(OFFICE_ASSET_BUCKET).upload(path, png, { contentType: "image/png", upsert: false, cacheControl: "31536000" });
    if (error) {
      console.error("[uploadOfficeChartPng]", error);
      return null;
    }
    const { data } = c.storage.from(OFFICE_ASSET_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, path };
  } catch (e) {
    console.error("[uploadOfficeChartPng]", e);
    return null;
  }
}

// ── Report Writer: data gatherers ───────────────────────────────────────────
// Each pulls from the platform's own stores/tables (nothing new to persist),
// filters to the requested range in JS the same way `getDashboard` already
// does, and returns one of the pure JSON shapes from office-hub.ts — the only
// facts the Report Writer's prompt is allowed to cite.

function inRange(iso: string | null | undefined, range: ReportDateRange): boolean {
  if (!iso) return false;
  const day = iso.slice(0, 10);
  return day >= range.start && day <= range.end;
}

export async function gatherHiringActivityData(employerId: string, range: ReportDateRange): Promise<HiringActivityData> {
  const empty: HiringActivityData = { jobsPosted: 0, totalApplicants: 0, interviewed: 0, offersExtended: 0, hired: 0, topJobs: [] };
  if (!employerId) return empty;
  try {
    const [jobs, applicants] = await Promise.all([listJobs(employerId), listApplicants(employerId)]);
    const jobsPosted = jobs.filter((j) => inRange(j.createdAt, range)).length;
    const inWindow = applicants.filter((a) => inRange(a.createdAt, range));

    const byJob = new Map<string, number>();
    for (const a of inWindow) {
      const title = a.jobTitle || "Unspecified role";
      byJob.set(title, (byJob.get(title) || 0) + 1);
    }
    const topJobs = Array.from(byJob.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([title, count]) => ({ title, applicants: count }));

    return {
      jobsPosted,
      totalApplicants: inWindow.length,
      interviewed: inWindow.filter((a) => a.status === "interviewed").length,
      offersExtended: inWindow.filter((a) => a.status === "offer extended").length,
      hired: inWindow.filter((a) => a.status === "hired").length,
      topJobs,
    };
  } catch (e) {
    console.error("[gatherHiringActivityData]", e);
    return empty;
  }
}

export async function gatherTimesheetSummaryData(employerId: string, range: ReportDateRange): Promise<TimesheetSummaryData> {
  const empty: TimesheetSummaryData = { totalHours: 0, employeeCount: 0, byEmployee: [], overtimeEmployees: [] };
  const c = db();
  if (!c || !employerId) return empty;
  try {
    const employees = await listEmployees(employerId);
    const nameById = new Map(employees.map((e) => [e.id, e.name || `Employee #${e.id}`] as const));
    const { data } = await c
      .from("time_entries")
      .select("employee_id, clock_in, clock_out")
      .eq("employer_id", employerId)
      .gte("clock_in", `${range.start}T00:00:00Z`)
      .lt("clock_in", `${addDaysISO(range.end, 1)}T00:00:00Z`)
      .limit(5000);

    const byEmp = new Map<number, number>();
    for (const r of data || []) {
      const id = r.employee_id as number;
      const hours = entryHours({ clockIn: (r.clock_in as string) || "", clockOut: (r.clock_out as string) || null });
      byEmp.set(id, (byEmp.get(id) || 0) + hours);
    }
    const byEmployee = Array.from(byEmp.entries())
      .map(([id, hours]) => ({ name: nameById.get(id) || `Employee #${id}`, hours: roundHours(hours) }))
      .sort((a, b) => b.hours - a.hours);

    return {
      totalHours: roundHours(byEmployee.reduce((sum, e) => sum + e.hours, 0)),
      employeeCount: byEmployee.length,
      byEmployee: byEmployee.slice(0, 50),
      overtimeEmployees: byEmployee.filter((e) => e.hours > 40),
    };
  } catch (e) {
    console.error("[gatherTimesheetSummaryData]", e);
    return empty;
  }
}

export async function gatherTrainingComplianceData(employerId: string, range: ReportDateRange): Promise<TrainingComplianceData> {
  const empty: TrainingComplianceData = { totalAssigned: 0, signed: 0, overdue: 0, pending: 0, compliancePct: 0, byDoc: [] };
  if (!employerId) return empty;
  try {
    const [docs, acks] = await Promise.all([listTrainingDocs(employerId), listAllAcknowledgments(employerId)]);
    // Compliance is a snapshot, not a stream: filter to acknowledgments due or
    // completed inside the window, but fall back to every assignment when the
    // window catches none, so a manager checking a quiet week still sees the
    // real standing rather than a false "nothing to report".
    const windowed = acks.filter((a) => inRange(a.acknowledgedAt, range) || inRange(a.dueAt, range));
    const rows = windowed.length ? windowed : acks;

    const docTitle = new Map(docs.map((d) => [d.id, d.title] as const));
    const byDocMap = new Map<number, { signed: number; total: number }>();
    let signed = 0;
    let overdue = 0;
    let pending = 0;
    for (const a of rows) {
      const state = complianceState(a);
      if (state === "signed" || state === "waived") signed++;
      else if (state === "overdue") overdue++;
      else pending++;

      const bucket = byDocMap.get(a.trainingDocId) || { signed: 0, total: 0 };
      bucket.total++;
      if (state === "signed" || state === "waived") bucket.signed++;
      byDocMap.set(a.trainingDocId, bucket);
    }
    const byDoc = Array.from(byDocMap.entries()).map(([id, v]) => ({ title: docTitle.get(id) || "Untitled training", ...v }));

    return {
      totalAssigned: rows.length,
      signed,
      overdue,
      pending,
      compliancePct: rows.length ? Math.round((signed / rows.length) * 100) : 0,
      byDoc,
    };
  } catch (e) {
    console.error("[gatherTrainingComplianceData]", e);
    return empty;
  }
}
