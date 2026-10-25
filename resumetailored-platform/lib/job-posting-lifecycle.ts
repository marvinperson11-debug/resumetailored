/**
 * Job posting lifecycle (Kimi prompt v3, migration 0071_job_distribution.sql)
 * — pure functions only, no DB, no network. Shared by:
 *   - the public job page's Google Jobs structured data (app/jobs/[jobId]/page.tsx)
 *   - the public jobs sitemap/robots (app/sitemap.ts)
 *   - the expiry nudge scan (lib/job-expiry-nudge.ts)
 *   - the daily brief's expiringJobs fact (lib/assistant-brief.ts)
 *
 * Marvin's rulings baked in here: Google Jobs markup is automatic on every
 * public listing at every tier (ruling 1); validThrough defaults to 30 days
 * from publish and a job past it is NEVER auto-closed or silently extended —
 * only nudged (ruling 5).
 */

export const JOB_DEFAULT_VALID_DAYS = 30;
export const JOB_NUDGE_INTERVAL_DAYS = 7;

/** `validThrough` if the employer set one, else `publishedAt` + 30 days — the
 *  one place this default is computed; every caller (markup, the expiry scan,
 *  the daily brief) goes through this rather than re-deriving it. Null when
 *  neither is known (the job has never been published). */
export function computeValidThrough(publishedAt: string | null, validThrough: string | null): string | null {
  if (validThrough) return validThrough;
  if (!publishedAt) return null;
  const t = new Date(publishedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + JOB_DEFAULT_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** The one gate for "is this job live on the public board" — active status
 *  AND public-listed, the same two conditions lib/employer-store.ts
 *  `getPublicJob` already requires to serve the page at all. */
export function isJobCurrentlyPublic(job: { status: string; publicListed?: boolean }): boolean {
  return job.status === "active" && !!job.publicListed;
}

/** True once the job's own COMPUTED validThrough has passed. False for a job
 *  with no publishedAt/validThrough at all — there is nothing to compare
 *  against, so it is never treated as expired by default. */
export function isJobPastValidThrough(job: { publishedAt: string | null; validThrough: string | null }, now: number = Date.now()): boolean {
  const computed = computeValidThrough(job.publishedAt, job.validThrough);
  if (!computed) return false;
  const t = new Date(computed).getTime();
  return Number.isFinite(t) && now > t;
}

/** Whether a fresh expiry nudge is due: never nudged yet, or the last one was
 *  at least JOB_NUDGE_INTERVAL_DAYS ago — the once-a-week cap (ruling 5). */
export function isNudgeDue(expiryNudgedAt: string | null, now: number = Date.now()): boolean {
  if (!expiryNudgedAt) return true;
  const t = new Date(expiryNudgedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return now - t >= JOB_NUDGE_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
}

// ── Google Jobs structured data (schema.org JobPosting) ─────────────────────
const EMPLOYMENT_TYPE_SCHEMA: Record<string, string> = {
  "full-time": "FULL_TIME",
  "part-time": "PART_TIME",
  contract: "CONTRACTOR",
  internship: "INTERN",
};
const SALARY_UNIT_SCHEMA: Record<string, string> = { hour: "HOUR", week: "WEEK", month: "MONTH", year: "YEAR" };

export interface JsonLdJobInput {
  id: number;
  title: string;
  description: string;
  location: string;
  remoteType: string;
  employmentType: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  salaryPeriod: string;
  status: string;
  publicListed?: boolean;
  publishedAt: string | null;
  validThrough: string | null;
  createdAt: string;
}

export interface JsonLdEmployerInput {
  companyName: string;
  logoUrl?: string | null;
}

/** schema.org JobPosting for Google Jobs, built ONLY from real DB fields — a
 *  field we don't actually have is omitted, never invented (e.g. there is no
 *  structured street/region/country for `location`, a free-text string, so
 *  only `addressLocality` is set; a remote job's `applicantLocationRequirements`
 *  is left out entirely since we don't record one). Null for anything not
 *  CURRENTLY public (closed/paused/draft/unlisted) — the caller renders no
 *  markup at all and sets `robots: noindex` for exactly that case. */
export function buildJobPostingJsonLd(job: JsonLdJobInput, employer: JsonLdEmployerInput, jobUrl: string): Record<string, unknown> | null {
  if (!isJobCurrentlyPublic(job)) return null;
  const datePosted = job.publishedAt || job.createdAt;
  if (!datePosted) return null;

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title,
    description: job.description,
    identifier: { "@type": "PropertyValue", name: "ResumeTailored", value: String(job.id) },
    datePosted,
    hiringOrganization: { "@type": "Organization", name: employer.companyName || "an employer" },
    directApply: true,
    url: jobUrl,
  };

  const validThrough = computeValidThrough(job.publishedAt, job.validThrough);
  if (validThrough) jsonLd.validThrough = validThrough;
  if (employer.logoUrl) (jsonLd.hiringOrganization as Record<string, unknown>).logo = employer.logoUrl;

  const schemaEmploymentType = EMPLOYMENT_TYPE_SCHEMA[job.employmentType];
  if (schemaEmploymentType) jsonLd.employmentType = schemaEmploymentType;

  if (job.remoteType === "remote") {
    jsonLd.jobLocationType = "TELECOMMUTE";
  } else if (job.location) {
    jsonLd.jobLocation = { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: job.location } };
  }

  if (job.salaryMin || job.salaryMax) {
    const value: Record<string, unknown> = { "@type": "QuantitativeValue" };
    if (job.salaryMin) value.minValue = job.salaryMin;
    if (job.salaryMax) value.maxValue = job.salaryMax;
    const unit = SALARY_UNIT_SCHEMA[job.salaryPeriod];
    if (unit) value.unitText = unit;
    jsonLd.baseSalary = { "@type": "MonetaryAmount", currency: job.salaryCurrency || "USD", value };
  }

  return jsonLd;
}
