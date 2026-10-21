import type Anthropic from "@anthropic-ai/sdk"; // type-only: erased at compile time, never bundled
import type { SupabaseClient } from "@supabase/supabase-js"; // type-only: see countOffersAwaitingSignatureLocal
import { listJobs, listApplicants, listEmployerIdsWithProfile, getEmployerProfile } from "./employer-store";
import { listInterviews } from "./employer-collab-store";
import { listPendingActions } from "./assistant-pending";
import { getBriefStates, setLastBriefAt, type BriefStateRow } from "./assistant-brief-store";
import { assistantStaleDays, assistantJobIdleDays, staleSummary, isJobIdle, daysSince, type StaleCandidateLike } from "./assistant-staleness";
import { logActivityForEmployer } from "./notifications-store";
import { logAction } from "./assistant-audit";
import { sendEmail, resolveUserEmail, escapeHtml, emailShell } from "./email";
import { employerSignatureHtml } from "./employer-signature";

/**
 * The Employer Portal AI Assistant's daily morning brief (Prompt 3). Ticked
 * from instrumentation.ts's existing 30-minute CERT_CRON-gated loop, so —
 * like lib/interview-reminders.ts and lib/assistant-send-worker.ts before it
 * — this file is DELIBERATELY self-contained: no lib/employer-notify.ts (its
 * context() helper reaches lib/docusign.ts -> Node's `crypto`, which breaks
 * the edge-runtime compile instrumentation.ts also goes through), and no
 * lib/employer-plan.ts / lib/assistant-chat.ts / lib/assistant-tools.ts /
 * lib/assistant-mutations.ts (all of which reach employer-notify.ts
 * transitively). Tier resolution and the brief's own LLM call are done with
 * their OWN minimal, dynamically-imported calls (`resolveTierLocal`,
 * `renderBriefViaLLM`) rather than reusing lib/employer-plan.ts's
 * `canAssistantMutate` / lib/assistant-chat.ts's Anthropic client — a few
 * duplicated lines, in exchange for `npm run build` staying green.
 */

const MAX_EMPLOYERS_PER_TICK = 25;
const CANDIDATE_FETCH_LIMIT = 500;

// ── pure: is a brief due right now? ─────────────────────────────────────────
/** Exported separately from the scan so the "boundary at exactly brief_hour,
 *  and exactly once per day" requirement is directly testable with no DB. */
export function briefDueNow(state: Pick<BriefStateRow, "lastBriefAt" | "briefHour">, now: number = Date.now()): boolean {
  const current = new Date(now);
  if (current.getUTCHours() < state.briefHour) return false;
  if (!state.lastBriefAt) return true;
  const todayBoundary = new Date(now);
  todayBoundary.setUTCHours(0, 0, 0, 0);
  const last = new Date(state.lastBriefAt).getTime();
  return Number.isFinite(last) ? last < todayBoundary.getTime() : true;
}

function briefQuietSkipEnabled(): boolean {
  const v = (process.env.ASSISTANT_BRIEF_QUIET_SKIP || "").trim().toLowerCase();
  return v !== "false" && v !== "off" && v !== "0";
}

// ── facts (every value traces to a real query result — see renderBriefViaLLM) ──
export interface BriefFacts {
  employerId: string;
  companyName: string;
  todayInterviews: { candidateName: string; jobTitle: string; scheduledAt: string }[];
  pendingActionsCount: number;
  newApplicantsByJob: { jobTitle: string; count: number }[];
  staleItems: { jobTitle: string; name: string; days: number }[];
  idleJobs: { jobTitle: string; days: number }[];
  /** Offer-letter envelopes (lib/assistant-mutations.ts `send_offer`, or the
   *  hand-driven DocuSign form) sent but not yet in a terminal state
   *  (completed/declined/voided) — Prompt 4. There is no polling
   *  infrastructure behind this: it's a plain count of what's already
   *  non-terminal right now, refreshed by whatever already updates envelope
   *  status (the DocuSign webhook / the employer's own polling page). */
  offersAwaitingSignature: number;
}

export function hasNothingToReport(
  facts: Pick<BriefFacts, "todayInterviews" | "pendingActionsCount" | "newApplicantsByJob" | "staleItems" | "idleJobs" | "offersAwaitingSignature">
): boolean {
  return (
    facts.todayInterviews.length === 0 &&
    facts.pendingActionsCount === 0 &&
    facts.newApplicantsByJob.length === 0 &&
    facts.staleItems.length === 0 &&
    facts.idleJobs.length === 0 &&
    facts.offersAwaitingSignature === 0
  );
}

// ── offers awaiting signature (minimal, duplicated query — see file header) ──
const DOCUSIGN_TERMINAL_STATUSES_LOCAL = new Set(["completed", "declined", "voided"]);
let docusignBriefClient: SupabaseClient | null = null;
async function countOffersAwaitingSignatureLocal(employerId: string): Promise<number> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    if (!docusignBriefClient) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
      if (!url || !key) return 0;
      docusignBriefClient = createClient(url, key, { auth: { persistSession: false } });
    }
    const { data } = await docusignBriefClient.from("docusign_envelopes").select("status").eq("employer_id", employerId).eq("doc_type", "offer").limit(500);
    return (data || []).filter((r) => !DOCUSIGN_TERMINAL_STATUSES_LOCAL.has((r.status as string) || "")).length;
  } catch {
    return 0;
  }
}

async function gatherBriefFacts(employerId: string, lastBriefAt: string | null, now: number): Promise<BriefFacts> {
  const profile = await getEmployerProfile(employerId).catch(() => null);
  const jobs = await listJobs(employerId).catch(() => []);
  const interviews = await listInterviews(employerId, { status: "scheduled" }).catch(() => []);

  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = todayStart.getTime() + 24 * 60 * 60 * 1000;
  const todayInterviews = interviews
    .filter((iv) => {
      const t = new Date(iv.scheduledAt).getTime();
      return Number.isFinite(t) && t >= todayStart.getTime() && t < todayEnd;
    })
    .map((iv) => ({ candidateName: iv.applicantName || "a candidate", jobTitle: iv.jobTitle || "", scheduledAt: iv.scheduledAt }));

  const pending = await listPendingActions(employerId).catch(() => []);

  const sinceMs = lastBriefAt && Number.isFinite(new Date(lastBriefAt).getTime()) ? new Date(lastBriefAt).getTime() : todayStart.getTime();
  const newByJob = new Map<string, number>();
  const staleDays = assistantStaleDays();
  const staleItems: { jobTitle: string; name: string; days: number }[] = [];
  for (const job of jobs) {
    const applicants = await listApplicants(employerId, { jobId: job.id }).catch(() => []);
    for (const a of applicants) {
      const createdMs = new Date(a.createdAt).getTime();
      if (Number.isFinite(createdMs) && createdMs >= sinceMs) newByJob.set(job.title, (newByJob.get(job.title) || 0) + 1);
    }
    const items: StaleCandidateLike[] = applicants.map((a) => ({ id: a.id, name: a.name, jobId: job.id, jobTitle: job.title, status: a.status, statusChangedAt: a.statusChangedAt }));
    const bucket = staleSummary(items, staleDays, now).byJob.get(job.id);
    if (bucket) for (const it of bucket.items) staleItems.push({ jobTitle: job.title, name: it.name, days: it.days });
  }
  staleItems.sort((a, b) => b.days - a.days);

  const idleDays = assistantJobIdleDays();
  const idleJobs = jobs
    .filter((j) => j.status === "active" && isJobIdle(j.updatedAt, idleDays, now))
    .map((j) => ({ jobTitle: j.title, days: daysSince(j.updatedAt, now) ?? idleDays }));

  const offersAwaitingSignature = await countOffersAwaitingSignatureLocal(employerId);

  return {
    employerId,
    companyName: profile?.companyName || "your company",
    todayInterviews,
    pendingActionsCount: pending.length,
    newApplicantsByJob: Array.from(newByJob.entries()).map(([jobTitle, count]) => ({ jobTitle, count })),
    staleItems,
    idleJobs,
    offersAwaitingSignature,
  };
}

// ── rendering: one capped LLM call, strict anti-fabrication, else a template ──
/** No model call, no network — assembled directly from `facts`, so the
 *  channel never goes fully dark just because the LLM is unavailable. */
export function fallbackBriefText(facts: BriefFacts): string {
  const lines: string[] = [`Good morning! Here's your ${facts.companyName} update:`];
  if (facts.todayInterviews.length) {
    lines.push(`Today's interviews: ${facts.todayInterviews.map((i) => `${i.candidateName} (${i.jobTitle || "no job on file"})`).join("; ")}.`);
  }
  if (facts.pendingActionsCount) {
    lines.push(`${facts.pendingActionsCount} assistant action${facts.pendingActionsCount === 1 ? "" : "s"} waiting for your approval.`);
  }
  if (facts.newApplicantsByJob.length) {
    lines.push(`New candidates since your last brief: ${facts.newApplicantsByJob.map((j) => `${j.count} for ${j.jobTitle}`).join(", ")}.`);
  }
  if (facts.staleItems.length) {
    lines.push(`Stale in the pipeline: ${facts.staleItems.slice(0, 5).map((s) => `${s.name} (${s.jobTitle}, ${s.days} days)`).join(", ")}.`);
  }
  if (facts.idleJobs.length) {
    lines.push(`Idle postings: ${facts.idleJobs.map((j) => `${j.jobTitle} (${j.days} days)`).join(", ")}.`);
  }
  return lines.join("\n");
}

/** One capped LLM call, given ONLY the assembled facts as JSON, forbidden
 *  from inventing anything not present in them. Null on ANY failure (no API
 *  key, upstream error, empty response) — the caller falls back to
 *  `fallbackBriefText`, never leaves the brief unsent. */
async function renderBriefViaLLM(facts: BriefFacts): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
    const anthropic = new AnthropicClient({ apiKey });
    const res = await anthropic.messages.create({
      model: process.env.ASSISTANT_MODEL || "claude-sonnet-4-6",
      max_tokens: 500,
      system:
        'Write a short, warm daily brief for an employer, using ONLY the facts in the JSON the user message contains. Never invent a name, count, date, job title, or any other fact not present in that JSON. If a field is an empty array, omit that topic entirely rather than mentioning "none". Plain text, no markdown headers.',
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

async function deliverBrief(employerId: string, facts: BriefFacts, text: string): Promise<void> {
  await logActivityForEmployer(employerId, {
    eventType: "assistant_daily_brief",
    title: "Your daily assistant brief",
    body: text.slice(0, 1000),
    link: "/employer/assistant",
  });
  const to = await resolveUserEmail(employerId).catch(() => null);
  if (!to) return;
  const signature = await employerSignatureHtml(employerId).catch(() => "");
  await sendEmail({
    to,
    subject: `Your ${facts.companyName} daily brief`,
    html: emailShell(`<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`, signature),
  }).catch(() => false);
}

// ── tier gate (duplicated minimally from lib/employer-plan.ts — see file header) ──
async function resolveTierLocal(userId: string): Promise<string> {
  try {
    const { isAdminId } = await import("./admin");
    if (isAdminId(userId)) return "corporate";
  } catch {
    /* ignore */
  }
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const tier = (user?.publicMetadata as { tier?: string } | undefined)?.tier;
    return tier === "scale" || tier === "corporate" || tier === "portal" ? tier : "free";
  } catch {
    return "free";
  }
}
function tierCanMutate(tier: string): boolean {
  return tier === "scale" || tier === "corporate";
}

// ── the scan ─────────────────────────────────────────────────────────────────
export interface BriefScanResult {
  scanned: number;
  sent: number;
  quietSkipped: number;
  llmFailed: number;
}

/** Ticked every 30 minutes from instrumentation.ts. For each employer whose
 *  brief is due (`briefDueNow`) AND who is Scale-tier or above
 *  (Portal-tier employers never get a brief — the acting assistant's own
 *  gate, lib/employer-plan.ts `canAssistantMutate`, duplicated locally
 *  above): gather facts, stamp `last_brief_at` BEFORE the LLM call (so a
 *  slow/failing render can't retry-storm the same employer this day), then
 *  either send a real brief or — on a quiet day with nothing to report —
 *  send nothing at all. Bounded to `MAX_EMPLOYERS_PER_TICK`; due employers
 *  past that cap are left for the next tick, prioritized by whoever has gone
 *  longest without a brief (never-briefed sorts first). */
export async function runDailyBriefScan(now: number = Date.now()): Promise<BriefScanResult> {
  const employerIds = await listEmployerIdsWithProfile(CANDIDATE_FETCH_LIMIT);
  if (!employerIds.length) return { scanned: 0, sent: 0, quietSkipped: 0, llmFailed: 0 };

  const states = await getBriefStates(employerIds);
  const due = employerIds
    .map((employerId) => ({ employerId, state: states.get(employerId) || { employerId, lastBriefAt: null, briefHour: 7 } }))
    .filter((c) => briefDueNow(c.state, now))
    .sort((a, b) => (a.state.lastBriefAt || "").localeCompare(b.state.lastBriefAt || ""));

  let scanned = 0;
  let sent = 0;
  let quietSkipped = 0;
  let llmFailed = 0;

  for (const candidate of due) {
    if (scanned >= MAX_EMPLOYERS_PER_TICK) break;
    const tier = await resolveTierLocal(candidate.employerId);
    if (!tierCanMutate(tier)) continue; // Portal-tier (or below): never due, never counted

    scanned++;
    const nowIso = new Date(now).toISOString();
    const facts = await gatherBriefFacts(candidate.employerId, candidate.state.lastBriefAt, now);

    if (hasNothingToReport(facts) && briefQuietSkipEnabled()) {
      await setLastBriefAt(candidate.employerId, nowIso);
      quietSkipped++;
      continue;
    }

    await setLastBriefAt(candidate.employerId, nowIso);
    let text = await renderBriefViaLLM(facts);
    if (!text) {
      text = fallbackBriefText(facts);
      await logAction({ employerId: candidate.employerId, actorUserId: candidate.employerId, action: "daily_brief", targetType: null, targetId: null, payload: {}, status: "failed" });
      llmFailed++;
    }
    await deliverBrief(candidate.employerId, facts, text);
    sent++;
  }

  return { scanned, sent, quietSkipped, llmFailed };
}
