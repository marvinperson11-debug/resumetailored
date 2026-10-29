import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { listJobs } from "./employer-store";
import { buildAttributionReport, type AttributionReport, type ApplicantAttributionRow } from "./attribution-report";

/**
 * Persistence for the employer "Applicants by channel" report (Combined
 * Build, Section 3). Reads ONLY `applicants.attribution` (migration 0071) —
 * no new data collection. A separate, tiny store module rather than adding
 * to lib/employer-store.ts's already-large `Applicant` mapping, since every
 * other read of `applicants` there deliberately never selects `attribution`
 * (it's irrelevant to the pipeline views) and this report needs it for
 * EVERY applicant, unfiltered by status.
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

/** Build the full attribution report for one employer — every job they own
 *  (even one with zero applicants, so it still renders a zero row), plus the
 *  account-wide aggregate. `jobId` narrows to one job (still returns the
 *  aggregate shape, with `byJob` holding just that one entry) for the
 *  per-job report view. */
export async function buildEmployerAttributionReport(employerId: string, jobId?: number): Promise<AttributionReport> {
  const c = db();
  const allJobs = await listJobs(employerId);
  const jobs = jobId ? allJobs.filter((j) => j.id === jobId) : allJobs;
  const applicantsByJobId = new Map<number, ApplicantAttributionRow[]>();
  if (c && jobs.length) {
    try {
      const ids = jobs.map((j) => j.id);
      const { data, error } = await c.from("applicants").select("job_id, attribution").in("job_id", ids);
      if (!error && data) {
        for (const row of data as { job_id: number; attribution: { utm_source?: string | null } | null }[]) {
          const list = applicantsByJobId.get(row.job_id) || [];
          list.push({ attribution: row.attribution ? { utmSource: row.attribution.utm_source } : null });
          applicantsByJobId.set(row.job_id, list);
        }
      }
    } catch (e) {
      console.error("[attribution-store] buildEmployerAttributionReport query failed", e);
    }
  }
  return buildAttributionReport(jobs.map((j) => ({ id: j.id, title: j.title })), applicantsByJobId);
}
