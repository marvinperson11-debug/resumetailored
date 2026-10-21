/**
 * Pipeline-staleness math for the Employer Portal AI Assistant — pure, no DB,
 * no network, so the "boundary at exactly N days" requirement is directly
 * testable without seeding Supabase. Shared by the daily morning brief
 * (lib/assistant-brief.ts) and the `get_pipeline_health` read-only tool
 * (lib/assistant-tools.ts), so the two surfaces can never disagree about what
 * counts as stale.
 *
 * A candidate counts as stale once their pipeline stage has sat unchanged for
 * `staleDays` or more (`>=`, so exactly N days already counts — the boundary
 * the test suite pins). `hired` and `rejected` are terminal: a candidate who
 * has already left the active pipeline is never "stale", however long ago
 * that happened.
 */

export const ASSISTANT_STALE_DAYS_DEFAULT = 7;
export const ASSISTANT_JOB_IDLE_DAYS_DEFAULT = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_STATUSES = new Set(["hired", "rejected"]);

export function assistantStaleDays(): number {
  const v = Number(process.env.ASSISTANT_STALE_DAYS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : ASSISTANT_STALE_DAYS_DEFAULT;
}

export function assistantJobIdleDays(): number {
  const v = Number(process.env.ASSISTANT_JOB_IDLE_DAYS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : ASSISTANT_JOB_IDLE_DAYS_DEFAULT;
}

/** Whole days elapsed since `iso`, or null when `iso` doesn't parse. */
export function daysSince(iso: string, now: number = Date.now()): number | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((now - t) / DAY_MS);
}

export interface StaleCandidateLike {
  id: number;
  name: string;
  jobId: number;
  jobTitle: string;
  status: string;
  statusChangedAt: string;
}

export function isStale(a: Pick<StaleCandidateLike, "status" | "statusChangedAt">, staleDays: number, now: number = Date.now()): boolean {
  if (TERMINAL_STATUSES.has(a.status)) return false;
  const days = daysSince(a.statusChangedAt, now);
  return days !== null && days >= staleDays;
}

export interface StaleJobBucket {
  jobId: number;
  jobTitle: string;
  count: number;
  items: { id: number; name: string; days: number }[];
}

export interface StaleSummary {
  totalStale: number;
  byJob: Map<number, StaleJobBucket>;
}

/** Group every stale candidate by job, longest-idle first within each job. */
export function staleSummary(applicants: StaleCandidateLike[], staleDays: number, now: number = Date.now()): StaleSummary {
  const byJob = new Map<number, StaleJobBucket>();
  let totalStale = 0;
  for (const a of applicants) {
    if (!isStale(a, staleDays, now)) continue;
    totalStale++;
    const days = daysSince(a.statusChangedAt, now) ?? 0;
    const bucket = byJob.get(a.jobId) || { jobId: a.jobId, jobTitle: a.jobTitle, count: 0, items: [] };
    bucket.count++;
    bucket.items.push({ id: a.id, name: a.name, days });
    byJob.set(a.jobId, bucket);
  }
  for (const bucket of Array.from(byJob.values())) bucket.items.sort((x: { days: number }, y: { days: number }) => y.days - x.days);
  return { totalStale, byJob };
}

/** Whether an ACTIVE job has had no update (new applicant, status move, edit)
 *  in `idleDays` or more — a cheap proxy for "nobody has touched this job in
 *  a while" using the job's own `updatedAt`, with no separate activity log. */
export function isJobIdle(updatedAt: string, idleDays: number, now: number = Date.now()): boolean {
  const days = daysSince(updatedAt, now);
  return days !== null && days >= idleDays;
}
