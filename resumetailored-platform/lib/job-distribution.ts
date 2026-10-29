/**
 * Job Distribution — Indeed XML feed + LinkedIn share/partner artifacts
 * (Kimi prompt v3, migration 0071_job_distribution.sql). Pure text/URL
 * builders only — no DB, no network, no Indeed/LinkedIn API calls (neither
 * has an open posting API; see the module header this prompt shipped with).
 *
 * Every string this file can produce is worded so it is never mistaken for
 * "this job is live there now" — Indeed and ZipRecruiter submission/approval
 * are each that service's own process, and LinkedIn direct posting requires
 * LinkedIn's own partner approval. scripts/test-employer-assistant.cjs greps
 * every artifact this module (and the card built from it) can produce for
 * "posted to indeed" / "posted to ziprecruiter" / "posted to linkedin" and
 * fails on a hit.
 *
 * Distribution Fix 2 adds three more pure field builders the Indeed XML feed
 * route (app/api/jobs/feed/[token]/route.ts) reads directly, verified against
 * docs.indeed.com/job-sync-xml/xml-feed (accessed 2026-10-25): `<jobtype>`,
 * `<salary>` as a range, and `<expirationdate>`. US city/state/country
 * parsing itself lives in lib/feed-location.ts (its own, separately-tested
 * module), not here.
 *
 * ZipRecruiter feed (additive sibling of the Indeed feed, not the LinkedIn
 * seam) adds the field builders the ZipRecruiter XML feed route
 * (app/api/jobs/ziprecruiter-feed/[token]/route.ts) reads directly, verified
 * against ZipRecruiter's live Feed Import documentation
 * (ziprecruiter.com/partner/documentation/feed-import/, accessed 2026-10-26
 * — that page carries no "v1.9" or any other version marker today; it is a
 * continuously-updated Docusaurus page, not a versioned PDF/spec, so this is
 * the current spec superseding any earlier v1.9 assumption). ZipRecruiter's
 * `<jobtype>` is a CLOSED set (unlike Indeed's open-ended passthrough) and
 * its compensation fields are four separate elements
 * (compensation_min/max/interval/currency), not one dash-range string like
 * Indeed's `<salary>` — see buildZipRecruiterJobType/
 * buildZipRecruiterCompensationFields below. ZipRecruiter's spec defines no
 * expiration field at all: removal from the feed (job closed, or the channel
 * turned off) is the only way a job stops being listed, which the feed route
 * already gets for free from the same live status+public_listed check (plus
 * channel-enabled filter) the Indeed feed uses — no separate expiry code
 * needed here.
 */

export type LinkedInMode = "share" | "partner_pending" | "partner_post";

export interface DistributionChannels {
  indeedFeed?: { enabled: boolean };
  linkedin?: { enabled: boolean; mode: LinkedInMode };
  zipRecruiter?: { enabled: boolean };
}

export interface DistributeJobInput {
  indeedFeed: boolean;
  linkedin: boolean;
  zipRecruiter: boolean;
  /** Explicit per-channel OFF signal (Combined Build, Section 5) — distinct
   *  from the three booleans above, which only ever turn a channel ON.
   *  Omitted/false here means "leave unchanged", exactly like the enable
   *  booleans; only `true` disables. If a channel is both requested on and
   *  off in the same call (shouldn't happen from any real UI/assistant
   *  path), disable wins — turning a channel off is the safer default to
   *  prefer on an ambiguous instruction. */
  disable?: { indeedFeed?: boolean; linkedin?: boolean; zipRecruiter?: boolean };
}

/** Builds the channels object to persist from a tool call's booleans,
 *  MERGED on top of any EXISTING row rather than replacing it outright —
 *  approving one channel must never clobber another channel a prior
 *  approval already turned on for the same job. Enabling a channel only
 *  ever adds it; disabling (via `input.disable`) only ever turns OFF the
 *  named channel(s), leaving every other channel's state exactly as it was
 *  — the same merge-on-top-of-existing semantics, just in the other
 *  direction. This also carries forward an EXISTING row's LinkedIn `mode`
 *  — the dormant partner-posting seam (nothing in this codebase ever writes
 *  anything other than 'share' into it, but a future partner-approved row's
 *  'partner_post' must survive a later re-approval of the SAME job rather
 *  than being reset back to 'share'). Disabling LinkedIn preserves its
 *  `mode` too — re-enabling it later should not have forgotten it. */
export function buildChannelsFromInput(input: DistributeJobInput, existing: DistributionChannels | null = null): DistributionChannels {
  const channels: DistributionChannels = { ...(existing || {}) };
  if (input.indeedFeed) channels.indeedFeed = { enabled: true };
  if (input.linkedin) channels.linkedin = { enabled: true, mode: existing?.linkedin?.mode || "share" };
  if (input.zipRecruiter) channels.zipRecruiter = { enabled: true };
  if (input.disable?.indeedFeed) channels.indeedFeed = { enabled: false };
  if (input.disable?.linkedin) channels.linkedin = { enabled: false, mode: channels.linkedin?.mode || existing?.linkedin?.mode || "share" };
  if (input.disable?.zipRecruiter) channels.zipRecruiter = { enabled: false };
  return channels;
}

/** Whether a disable request names at least one channel — used by the route
 *  layer to tell "nothing to disable" apart from a real request. */
export function hasDisableRequest(disable: DistributeJobInput["disable"]): boolean {
  return !!(disable?.indeedFeed || disable?.linkedin || disable?.zipRecruiter);
}

export function buildIndeedFeedUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/api/jobs/feed/${token}`;
}

/** Same employer feed token as the Indeed feed (ensureEmployerFeedToken/
 *  getEmployerIdByFeedToken in lib/job-distribution-store.ts are channel-
 *  agnostic — one unguessable token resolves the employer for either feed
 *  route), just a different path segment. */
export function buildZipRecruiterFeedUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/api/jobs/ziprecruiter-feed/${token}`;
}

/** UTM-tags a job URL for one distribution channel — every link this module
 *  hands the employer goes through this, never a bare job URL (migration
 *  0071's `applicants.attribution`). */
export function addUtm(jobUrl: string, source: "indeed" | "linkedin" | "google_jobs" | "ziprecruiter"): string {
  const u = new URL(jobUrl);
  u.searchParams.set("utm_source", source);
  u.searchParams.set("utm_medium", "job_distribution");
  u.searchParams.set("utm_campaign", "job_distribution");
  return u.toString();
}

/** Plain-language instructions for getting feed-included jobs onto Indeed —
 *  submission and approval are Indeed's own process, never claimed as
 *  already done. */
export function buildIndeedFeedInstructions(feedUrl: string): string {
  return [
    `Your Indeed jobs feed (every job you've turned the Indeed feed on for, including this one):\n${feedUrl}`,
    `To get these jobs in front of Indeed's own review:\n1. Sign in at indeed.com/employers (or create a free employer account).\n2. Look for "Import jobs via XML feed" in your employer dashboard, or contact Indeed support and give them the feed URL above to register it.\n3. Indeed reviews and approves feed submissions themselves — that decision, and the timing (often a few days), is entirely theirs.\n4. Once approved, check your jobs on Indeed directly to confirm they're showing — we have no way to confirm Indeed's side for you.`,
  ].join("\n\n");
}

/** Plain-language instructions for getting feed-included jobs onto
 *  ZipRecruiter — submission is a manual step the employer takes through
 *  their own ZipRecruiter account; ZipRecruiter's own processing/review is
 *  never claimed as already done, matching the Indeed instructions' honesty
 *  rule above (and the same banned-wording grep in
 *  scripts/test-employer-assistant.cjs, extended to cover this channel). */
export function buildZipRecruiterFeedInstructions(feedUrl: string): string {
  return [
    `Your ZipRecruiter jobs feed (every job you've turned the ZipRecruiter feed on for, including this one):\n${feedUrl}`,
    `To get these jobs in front of ZipRecruiter's own review:\n1. Sign in at ziprecruiter.com/employers (or create a free employer account).\n2. Look for "Feed Import" in your employer dashboard, or contact ZipRecruiter support and give them the feed URL above to register it.\n3. ZipRecruiter processes registered feeds on its own schedule and reviews them itself — that decision, and the timing, is entirely theirs.\n4. Once live, check your jobs on ZipRecruiter directly to confirm they're showing — we have no way to confirm ZipRecruiter's side for you.`,
  ].join("\n\n");
}

export function buildLinkedInShareUrl(jobUrl: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(jobUrl)}`;
}

/** Prewritten LinkedIn post text the employer can paste as-is — the share
 *  LINK is what actually opens LinkedIn's own share dialog; that endpoint
 *  doesn't accept prefilled body text as a query parameter, so this is copy
 *  to paste alongside it, not something baked into the link itself. */
export function buildLinkedInShareCopy(title: string, company: string, jobUrl: string): string {
  return `We're hiring: ${title} at ${company}.\n\n${jobUrl}`;
}

/** Honest about what applying for LinkedIn partner access actually means: a
 *  real external application to LinkedIn, LinkedIn's own decision, LinkedIn's
 *  own timeline — never phrased as something this product can grant on its
 *  own, and never implying direct posting is live today. */
export function buildLinkedInPartnerInstructions(): string {
  return [
    "LinkedIn has no open API for posting jobs directly — the only path to posting programmatically is LinkedIn's own Talent Solutions / Jobs API partner program, which requires LinkedIn's approval.",
    "What it unlocks, once approved: jobs go directly into LinkedIn's own listings with a native apply flow, replacing the share-link step above.",
    "Whose decision: LinkedIn's alone. Typical review takes weeks to months, and approval isn't guaranteed.",
    "What to have ready before applying: your company's LinkedIn Page (create or claim one if you don't have one yet), a verified company domain on that page, your legal company name, your company's size/revenue band, a short description of how your hiring portal works and why programmatic posting fits it, your expected job-posting volume per month, and a public privacy policy URL.",
    "Until LinkedIn approves this, the share link above is what's real and available today — nothing here is presented as live on LinkedIn until that changes.",
  ].join("\n\n");
}

/** `job_postings.employment_type` -> Indeed's `<jobtype>` value. The doc's
 *  own worked example only names "fulltime, parttime" explicitly, but is
 *  silent on anything else being wrong ("Indeed might also pull this value
 *  directly from other job content that you provide") — contract/internship
 *  are the same lowercase-no-hyphen convention and are passed through on
 *  that basis, best-effort. "temporary" isn't a value our own employmentType
 *  taxonomy can hold yet (lib/employer-ai.ts EMPLOYMENT_TYPES), so the entry
 *  below is a no-op today, kept only so a future taxonomy addition needs no
 *  change here. An employment type with no mapping (or unset) omits the
 *  element entirely, matching the field's "Required if on the career site". */
const INDEED_JOBTYPE: Record<string, string> = {
  "full-time": "fulltime",
  "part-time": "parttime",
  contract: "contract",
  internship: "internship",
  temporary: "temporary",
};
export function buildIndeedJobType(employmentType: string): string {
  return INDEED_JOBTYPE[employmentType] || "";
}

/** Indeed's `<salary>` is a single element — a best-practices range is a
 *  dash between two numbers in the SAME string (the doc's own example:
 *  "$16.00-$20.00 per hour"), not two separate min/max elements. Only the
 *  range case is new: when just one bound exists this reproduces the feed's
 *  pre-Fix-2 single-value string exactly, so a min-only job's XML is
 *  unchanged. Neither bound -> "" (element omitted, same as today). */
export function buildIndeedSalaryField(min: number | null, max: number | null, currency: string, period: string): string {
  if (!min && !max) return "";
  if (min && max && min !== max) return `${min}-${max} ${currency} per ${period}`;
  return `${min || max} ${currency} per ${period}`;
}

/** Indeed's `<expirationdate>` is a plain date (the doc's own example,
 *  "2021-11-08" — no time component, unlike `<date>`'s full ISO-8601
 *  timestamp). `validThrough` here is already the COMPUTED value
 *  (lib/job-posting-lifecycle.ts computeValidThrough) — explicit
 *  valid_through if the employer set one, else publishedAt + 30 days. Null
 *  (never published) -> "" so the element is omitted. */
export function toIndeedExpirationDate(computedValidThrough: string | null): string {
  if (!computedValidThrough) return "";
  const t = new Date(computedValidThrough).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : "";
}

/** `job_postings.employment_type` -> ZipRecruiter's `<jobtype>`. Unlike
 *  Indeed's open-ended passthrough above, ZipRecruiter's own doc is explicit
 *  that `<jobtype>` is a CLOSED set ("must contain only the explicit values
 *  noted in this document, otherwise the job will be rejected") — Full-Time,
 *  Part-Time, Contractor, Temporary, Per Diem, Other, case-insensitive. Our
 *  own employmentType taxonomy (lib/employer-ai.ts EMPLOYMENT_TYPES) only
 *  ever holds full-time/part-time/contract/internship — "internship" has no
 *  honest match in ZipRecruiter's set, so it (and anything unset/unknown)
 *  falls to "Other" rather than being omitted, since the field isn't
 *  optional-by-omission here the way Indeed's is. */
const ZIPRECRUITER_JOBTYPE: Record<string, string> = {
  "full-time": "Full-Time",
  "part-time": "Part-Time",
  contract: "Contractor",
};
export function buildZipRecruiterJobType(employmentType: string): string {
  return ZIPRECRUITER_JOBTYPE[employmentType] || "Other";
}

/** `job_postings.salary_period` -> ZipRecruiter's `<compensation_interval>`
 *  (Acceptable values: Annually, Monthly, Weekly, Daily, Hourly). Our own pay
 *  period taxonomy (lib/pay-transparency.ts PAY_PERIODS) only ever holds
 *  hour/week/month/year — there is no "day" today, so "Daily" is listed only
 *  so a future taxonomy addition needs no change here, same reasoning as
 *  Indeed's dormant "temporary" entry above. */
const ZIPRECRUITER_COMPENSATION_INTERVAL: Record<string, string> = {
  hour: "Hourly",
  week: "Weekly",
  month: "Monthly",
  year: "Annually",
  day: "Daily",
};

export interface ZipRecruiterCompensationFields {
  compensation_min?: string;
  compensation_max?: string;
  compensation_interval?: string;
  compensation_currency?: string;
}

/** ZipRecruiter's compensation is four separate elements, not one dash-range
 *  string like Indeed's `<salary>` — confirmed against the live doc's own
 *  example feed (separate compensation_interval/min/max/currency tags).
 *  compensation_currency is "Required if compensation_min/compensation_max
 *  is provided" per the doc, so it (and the interval, which is meaningless
 *  without one) rides along with either bound; neither bound set omits all
 *  four fields, matching "no `<salary>`-equivalent element" for an
 *  unspecified job, same as the Indeed builder. */
export function buildZipRecruiterCompensationFields(min: number | null, max: number | null, currency: string, period: string): ZipRecruiterCompensationFields {
  if (!min && !max) return {};
  const fields: ZipRecruiterCompensationFields = {
    compensation_interval: ZIPRECRUITER_COMPENSATION_INTERVAL[period] || "Annually",
    compensation_currency: currency,
  };
  if (min) fields.compensation_min = String(min);
  if (max) fields.compensation_max = String(max);
  return fields;
}
