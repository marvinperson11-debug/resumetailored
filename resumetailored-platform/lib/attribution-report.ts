/**
 * Employer "Applicants by channel" report (Combined Build, Section 3 — the
 * distribution-reporting piece deliberately deferred when job distribution
 * itself shipped). Pure aggregation: reads ONLY the `attribution` jsonb
 * already captured on `applicants` at apply time (migration 0071) — no new
 * data collection, no estimates. An applicant with no attribution (direct
 * traffic, or a job-board visit with no UTM) buckets into "direct", never
 * blank and never silently dropped.
 */

export const ATTRIBUTION_CHANNELS = ["google_jobs", "indeed", "linkedin", "ziprecruiter"] as const;
export type AttributionChannel = (typeof ATTRIBUTION_CHANNELS)[number];
export const ATTRIBUTION_DIRECT = "direct" as const;

export interface AttributionCounts {
  total: number;
  byChannel: Record<AttributionChannel, number>;
  direct: number;
}

export interface ApplicantAttributionRow {
  attribution: { utmSource?: string | null } | null;
}

function normalizeSource(utmSource: string | null | undefined): AttributionChannel | typeof ATTRIBUTION_DIRECT {
  const s = (utmSource || "").trim().toLowerCase();
  if ((ATTRIBUTION_CHANNELS as readonly string[]).includes(s)) return s as AttributionChannel;
  return ATTRIBUTION_DIRECT;
}

/** Zero-filled counts for every known channel — the empty/zero shape the
 *  report always renders, even with no applicants at all (spec: "no
 *  attribution rows → report renders zeros, not blanks"). */
export function emptyAttributionCounts(): AttributionCounts {
  const byChannel = {} as Record<AttributionChannel, number>;
  for (const c of ATTRIBUTION_CHANNELS) byChannel[c] = 0;
  return { total: 0, byChannel, direct: 0 };
}

/** Count applicants by channel. Pure — no DB, no network; the caller
 *  supplies rows already read from `applicants`. */
export function buildAttributionCounts(rows: ApplicantAttributionRow[]): AttributionCounts {
  const counts = emptyAttributionCounts();
  for (const row of rows) {
    const bucket = normalizeSource(row.attribution?.utmSource);
    if (bucket === ATTRIBUTION_DIRECT) counts.direct++;
    else counts.byChannel[bucket]++;
    counts.total++;
  }
  return counts;
}

export interface JobAttributionReport {
  jobId: number;
  jobTitle: string;
  counts: AttributionCounts;
}

export interface AttributionReport {
  /** Account-wide aggregate across every job passed in. */
  aggregate: AttributionCounts;
  byJob: JobAttributionReport[];
}

/** Build the full report (per job + account aggregate) from applicant rows
 *  already grouped by job. `jobs` only supplies the id/title to label each
 *  row — a job with zero applicants still appears with zero counts, so an
 *  employer never reads "no row" as "we don't know." */
export function buildAttributionReport(jobs: { id: number; title: string }[], applicantsByJobId: Map<number, ApplicantAttributionRow[]>): AttributionReport {
  const byJob: JobAttributionReport[] = jobs.map((job) => ({
    jobId: job.id,
    jobTitle: job.title,
    counts: buildAttributionCounts(applicantsByJobId.get(job.id) || []),
  }));
  const allRows = jobs.flatMap((job) => applicantsByJobId.get(job.id) || []);
  return { aggregate: buildAttributionCounts(allRows), byJob };
}
