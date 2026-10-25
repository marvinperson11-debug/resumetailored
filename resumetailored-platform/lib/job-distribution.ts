/**
 * Job Distribution — Indeed XML feed + LinkedIn share/partner artifacts
 * (Kimi prompt v3, migration 0071_job_distribution.sql). Pure text/URL
 * builders only — no DB, no network, no Indeed/LinkedIn API calls (neither
 * has an open posting API; see the module header this prompt shipped with).
 *
 * Every string this file can produce is worded so it is never mistaken for
 * "this job is live there now" — Indeed submission/approval is Indeed's own
 * process, and LinkedIn direct posting requires LinkedIn's own partner
 * approval. scripts/test-employer-assistant.cjs greps every artifact this
 * module (and the card built from it) can produce for "posted to indeed" /
 * "posted to linkedin" and fails on a hit.
 */

export type LinkedInMode = "share" | "partner_pending" | "partner_post";

export interface DistributionChannels {
  indeedFeed?: { enabled: boolean };
  linkedin?: { enabled: boolean; mode: LinkedInMode };
}

export interface DistributeJobInput {
  indeedFeed: boolean;
  linkedin: boolean;
}

/** Builds the channels object to persist from a tool call's booleans,
 *  carrying forward any EXISTING row's LinkedIn `mode` — the dormant
 *  partner-posting seam (nothing in this codebase ever writes anything other
 *  than 'share' into it, but a future partner-approved row's 'partner_post'
 *  must survive a later re-approval of the SAME job rather than being reset
 *  back to 'share'). */
export function buildChannelsFromInput(input: DistributeJobInput, existing: DistributionChannels | null = null): DistributionChannels {
  const channels: DistributionChannels = {};
  if (input.indeedFeed) channels.indeedFeed = { enabled: true };
  if (input.linkedin) channels.linkedin = { enabled: true, mode: existing?.linkedin?.mode || "share" };
  return channels;
}

export function buildIndeedFeedUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/api/jobs/feed/${token}`;
}

/** UTM-tags a job URL for one distribution channel — every link this module
 *  hands the employer goes through this, never a bare job URL (migration
 *  0071's `applicants.attribution`). */
export function addUtm(jobUrl: string, source: "indeed" | "linkedin" | "google_jobs"): string {
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
