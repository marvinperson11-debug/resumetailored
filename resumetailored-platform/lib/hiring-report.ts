import type Anthropic from "@anthropic-ai/sdk"; // type-only: see renderHiringReportViaLLM
import { listJobs, listApplicants, getEmployerProfile } from "./employer-store";
import { APPLICANT_STATUSES, type ApplicantStatus } from "./employer-ai";
import { assistantStaleDays, staleSummary, daysSince, type StaleCandidateLike } from "./assistant-staleness";

/**
 * Plain-language hiring reports (Prompt 5, `hiring_report` — Portal tier and
 * up, read-only, same gate as the other five read-only tools). Same two-step
 * shape as the daily morning brief (lib/assistant-brief.ts): assemble FACTS
 * from the database only, then one capped LLM call turns them into prose —
 * never the other way around. The LLM is never the source of a number, only
 * of the sentences describing numbers it was handed; `hiringReportSourceNumbers`
 * renders the SAME facts as a plain list so the employer can check the prose
 * against it line by line, and the tool hands both back untouched.
 */

export type HiringReportPeriod = "week" | "month" | "all";
const DAY_MS = 24 * 60 * 60 * 1000;

function periodStartMs(period: HiringReportPeriod, now: number): number {
  if (period === "week") return now - 7 * DAY_MS;
  if (period === "month") return now - 30 * DAY_MS;
  return 0;
}

export interface HiringReportFacts {
  period: HiringReportPeriod;
  companyName: string;
  applicantsPerJob: { jobTitle: string; count: number }[];
  funnelCounts: Record<ApplicantStatus, number>;
  /** Jobs with a candidate who reached "hired" within the period — days from
   *  the job's own createdAt to that hire's statusChangedAt. */
  timeToFillDays: { jobTitle: string; days: number }[];
  /** Top 5 longest-idle pipeline items — the exact same staleness math as
   *  get_pipeline_health / the daily brief (lib/assistant-staleness.ts), so
   *  this never disagrees with what those surfaces already show. */
  longestIdle: { jobTitle: string; name: string; days: number }[];
  /** Average hours from an applicant's createdAt to their statusChangedAt,
   *  over applicants who moved out of "new" within the period — null when
   *  there's nothing to average (never 0, which would read as "instant"). */
  avgResponseHours: number | null;
}

export async function gatherHiringReportFacts(employerId: string, period: HiringReportPeriod, now: number = Date.now()): Promise<HiringReportFacts> {
  const profile = await getEmployerProfile(employerId).catch(() => null);
  const jobs = await listJobs(employerId).catch(() => []);
  const periodStart = periodStartMs(period, now);
  const staleDays = assistantStaleDays();

  const applicantsPerJob: { jobTitle: string; count: number }[] = [];
  const funnelCounts = Object.fromEntries(APPLICANT_STATUSES.map((s) => [s, 0])) as Record<ApplicantStatus, number>;
  const timeToFillDays: { jobTitle: string; days: number }[] = [];
  const longestIdleRaw: { jobTitle: string; name: string; days: number }[] = [];
  let responseHoursSum = 0;
  let responseCount = 0;

  for (const job of jobs) {
    const applicants = await listApplicants(employerId, { jobId: job.id }).catch(() => []);
    const inPeriod = applicants.filter((a) => {
      const t = new Date(a.createdAt).getTime();
      return Number.isFinite(t) && t >= periodStart;
    });
    if (inPeriod.length) applicantsPerJob.push({ jobTitle: job.title, count: inPeriod.length });

    for (const a of applicants) {
      funnelCounts[a.status] = (funnelCounts[a.status] || 0) + 1;
      const changedMs = new Date(a.statusChangedAt).getTime();
      const createdMs = new Date(a.createdAt).getTime();
      const changedInPeriod = Number.isFinite(changedMs) && changedMs >= periodStart;

      if (a.status === "hired" && changedInPeriod) {
        const days = daysSince(job.createdAt, changedMs);
        if (days !== null) timeToFillDays.push({ jobTitle: job.title, days });
      }
      if (a.status !== "new" && changedInPeriod && Number.isFinite(createdMs) && changedMs >= createdMs) {
        responseHoursSum += (changedMs - createdMs) / (60 * 60 * 1000);
        responseCount++;
      }
    }

    const items: StaleCandidateLike[] = applicants.map((a) => ({ id: a.id, name: a.name, jobId: job.id, jobTitle: job.title, status: a.status, statusChangedAt: a.statusChangedAt }));
    const bucket = staleSummary(items, staleDays, now).byJob.get(job.id);
    if (bucket) for (const it of bucket.items) longestIdleRaw.push({ jobTitle: job.title, name: it.name, days: it.days });
  }
  longestIdleRaw.sort((a, b) => b.days - a.days);

  return {
    period,
    companyName: profile?.companyName || "your company",
    applicantsPerJob,
    funnelCounts,
    timeToFillDays,
    longestIdle: longestIdleRaw.slice(0, 5),
    avgResponseHours: responseCount ? Math.round((responseHoursSum / responseCount) * 10) / 10 : null,
  };
}

/** A plain list of every number the prose is allowed to describe — shown
 *  beneath the report so the employer can check it line by line. */
export function hiringReportSourceNumbers(facts: HiringReportFacts): string[] {
  const lines: string[] = [];
  for (const j of facts.applicantsPerJob) lines.push(`${j.jobTitle}: ${j.count} new applicant${j.count === 1 ? "" : "s"}`);
  for (const s of APPLICANT_STATUSES) if (facts.funnelCounts[s]) lines.push(`${s}: ${facts.funnelCounts[s]}`);
  for (const t of facts.timeToFillDays) lines.push(`${t.jobTitle} filled in ${t.days} day${t.days === 1 ? "" : "s"}`);
  for (const idle of facts.longestIdle) lines.push(`${idle.name} (${idle.jobTitle}): idle ${idle.days} day${idle.days === 1 ? "" : "s"}`);
  if (facts.avgResponseHours !== null) lines.push(`Average time to first move a candidate out of "new": ${facts.avgResponseHours}h`);
  return lines;
}

/** No model call, no network — assembled directly from `facts`, so a report
 *  is never fully unavailable just because the LLM is down. */
export function fallbackHiringReportText(facts: HiringReportFacts): string {
  const lines: string[] = [`Hiring report (${facts.period}) for ${facts.companyName}:`];
  if (facts.applicantsPerJob.length) lines.push(`New applicants: ${facts.applicantsPerJob.map((j) => `${j.count} for ${j.jobTitle}`).join(", ")}.`);
  const funnelParts = APPLICANT_STATUSES.filter((s) => facts.funnelCounts[s]).map((s) => `${facts.funnelCounts[s]} ${s}`);
  if (funnelParts.length) lines.push(`Pipeline right now: ${funnelParts.join(", ")}.`);
  if (facts.timeToFillDays.length) lines.push(`Filled this period: ${facts.timeToFillDays.map((t) => `${t.jobTitle} in ${t.days} day${t.days === 1 ? "" : "s"}`).join(", ")}.`);
  if (facts.longestIdle.length) lines.push(`Longest idle: ${facts.longestIdle.map((i) => `${i.name} (${i.jobTitle}, ${i.days}d)`).join(", ")}.`);
  if (facts.avgResponseHours !== null) lines.push(`Average time to first move a candidate out of "new": ${facts.avgResponseHours}h.`);
  if (lines.length === 1) lines.push("Nothing to report for this period yet.");
  return lines.join("\n");
}

/** One capped LLM call, given ONLY the assembled facts as JSON, forbidden
 *  from inventing anything not present in them. Null on ANY failure — the
 *  caller falls back to `fallbackHiringReportText`. */
async function renderHiringReportViaLLM(facts: HiringReportFacts): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
    const anthropic = new AnthropicClient({ apiKey });
    const res = await anthropic.messages.create({
      model: process.env.ASSISTANT_MODEL || "claude-sonnet-4-6",
      max_tokens: 500,
      system:
        'Write a short, plain-language hiring report for an employer, using ONLY the facts in the JSON the user message contains. Never invent a job title, name, count, day figure, or any other fact not present in that JSON. If a field is an empty array or null, omit that topic entirely rather than mentioning "none" or "N/A". Plain text, no markdown headers.',
      messages: [{ role: "user", content: JSON.stringify(facts) }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

export interface HiringReportResult {
  period: HiringReportPeriod;
  report: string;
  sourceNumbers: string[];
}

export async function buildHiringReport(employerId: string, period: HiringReportPeriod, now: number = Date.now()): Promise<HiringReportResult> {
  const facts = await gatherHiringReportFacts(employerId, period, now);
  const sourceNumbers = hiringReportSourceNumbers(facts);
  const prose = (await renderHiringReportViaLLM(facts)) || fallbackHiringReportText(facts);
  return { period, report: prose, sourceNumbers };
}
