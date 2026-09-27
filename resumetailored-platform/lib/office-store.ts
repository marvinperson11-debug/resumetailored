import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ChartPoint, ChartSource } from "./office-hub";
import { listEmployees } from "./employees-store";
import { listApplicants } from "./employer-store";
import { listEntriesForWeek } from "./time-store";
import { sumHours, weekStartISO, roundHours } from "./time-hub";
import { listAllAcknowledgments } from "./training-store";
import { complianceState } from "./employee-hub";

/**
 * Office suite persistence: live chart data sources (built from the platform's
 * own stores — nothing new to persist for these) + the office-assets bucket
 * upload for "Insert into a document". Same service-role pattern as the other
 * employer stores.
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
async function applicantsOverTime(employerId: string): Promise<ChartPoint[]> {
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
    label: new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
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

export async function chartDataForSource(employerId: string, source: ChartSource): Promise<ChartPoint[]> {
  if (!employerId) return [];
  try {
    if (source === "applicants") return await applicantsOverTime(employerId);
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
