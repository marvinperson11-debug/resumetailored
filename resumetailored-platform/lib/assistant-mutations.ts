import { getJob, listApplicants, getApplicant, createJob, updateJob, updateApplicant, getEmployerProfile } from "./employer-store";
import { jobPublishViolation } from "./job-publish-validation";
import { listInterviews, createInterview, getInterview, getInterviewForToken, updateInterview } from "./employer-collab-store";
import { notifyCandidateOfInterview, notifyInterviewerOfInterview } from "./employer-notify";
import { APPLICANT_STATUSES, isApplicantStatus, isInterviewMode, type ApplicantStatus, type Applicant } from "./employer-ai";
import {
  getPendingActionById,
  claimForExecution,
  markFailed as markPendingFailed,
  markCancelled,
  patchPendingActionPayload,
  isPendingExpired,
  cancelSiblingPending,
  type PendingActionArtifact,
  type PendingActionRow,
  type PendingActionStatus,
} from "./assistant-pending";
import { enqueueSend } from "./assistant-send-queue";
import { logAction } from "./assistant-audit";
import { observeApprovedAction } from "./assistant-employer-learning";
import { logActivityForEmployer } from "./notifications-store";
import { createAckSetting, getActiveAckSettingForScope, setAckSettingEnabled } from "./assistant-ack-settings";
import { ackEmailParts, renderAckEmailPlainText } from "./assistant-ack-render";
import { sendOfferEnvelope } from "./docusign-offer-send";
import { getEmployerTimezone, formatEmployerTime } from "./employer-time";
import { saveInterviewKit, type InterviewKitContent } from "./interview-kits";
import { saveInterviewSummary } from "./interview-summaries";
import { getJobFaq, upsertJobFaqContent, setJobFaqEnabled, type JobFaqPair } from "./job-faq-store";
import { buildQAGrounding, isJobPublished, generateQaSamples, type QaSamplesOutcome } from "./job-faq";
import type { OnboardingPlanContent } from "./onboarding-plan";
import { saveOnboardingPlan } from "./onboarding-store";
import { listEmployees, createEmployee } from "./employees-store";
import type { Access } from "./plan";
import { isJobCurrentlyPublic } from "./job-posting-lifecycle";
import {
  buildChannelsFromInput,
  buildIndeedFeedUrl,
  buildIndeedFeedInstructions,
  buildZipRecruiterFeedUrl,
  buildZipRecruiterFeedInstructions,
  buildLinkedInShareUrl,
  buildLinkedInShareCopy,
  buildLinkedInPartnerInstructions,
  addUtm,
  type DistributionChannels,
} from "./job-distribution";
import { ensureEmployerFeedToken, getDistribution, upsertDistribution } from "./job-distribution-store";
import { parseFeedLocation, FEED_LOCATION_UNPARSEABLE_NOTICE, FEED_LOCATION_UNPARSEABLE_NOTICE_ZIPRECRUITER } from "./feed-location";
import { appUrl } from "./subdomain";
import { getFreeTierState, jobCreateAllowed, incrementJobsCount, checkFreeJobEdit, gradeGate } from "./employer-free-tier";

/**
 * The mutating core behind the Employer Portal AI Assistant's confirmation
 * card (docs/assistant-confirmation-card.md). Two halves, used by different
 * callers:
 *
 *   - "build*Artifact" functions: called from the mutating tool executors in
 *     lib/assistant-tools.ts, DURING the chat turn. They validate the tool's
 *     input, resolve every ambiguity into real names/jobs/stages using the
 *     same lib/employer-store.ts + lib/employer-collab-store.ts functions the
 *     read-only tools already use, and return the exact artifact the card
 *     will render. They never write anything beyond the pending-action row
 *     itself (lib/assistant-pending.ts `createPendingAction`).
 *
 *   - `executePendingAction` + `approvePendingAction`/`cancelPendingAction`:
 *     called from the approve/cancel routes, AFTER a human has looked at the
 *     card. This is the only place any of these tools' real mutation
 *     happens — via the exact same portal lib functions the hand-driven
 *     employer UI calls (createJob, updateApplicant, createInterview,
 *     the candidate-message send queue), never a parallel implementation.
 */

export const ASSISTANT_UNDO_WINDOW_SECONDS = (() => {
  const v = Number(process.env.ASSISTANT_UNDO_WINDOW_SECONDS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 60;
})();

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function numArray(v: unknown): number[] {
  return Array.isArray(v) ? v.map(num).filter((n): n is number => n !== null) : [];
}
function firstLine(text: string): string {
  return (text.split("\n").find((l) => l.trim()) || "").trim().slice(0, 200);
}
function personalize(body: string, a: Pick<Applicant, "name">): string {
  const firstName = (a.name || "there").split(" ")[0] || "there";
  return body.replace(/\{\{\s*firstName\s*\}\}/gi, firstName).replace(/\{\{\s*name\s*\}\}/gi, a.name || "there");
}

/** Fix Round 6, Section B: a display string for the wage, preferring the
 *  free-text `pay_range` the employer/model wrote (e.g. "$70,000–$90,000")
 *  but falling back to the structured salary_min/salary_max when pay_range
 *  was never set — those two were being supplied independently (pay_range is
 *  "not used for the publish check", so a model relying on salary_min/
 *  salary_max alone is expected), and without this fallback a card could
 *  have the wage stored (and pass the publish gate) while showing no wage
 *  at all. Empty string when neither is present. */
function formatPayRangeDisplay(payRangeText: string, salaryMin: number | null, salaryMax: number | null): string {
  if (payRangeText) return payRangeText;
  if (salaryMin !== null && salaryMax !== null) {
    return salaryMin === salaryMax ? `$${salaryMin.toLocaleString()}` : `$${salaryMin.toLocaleString()}–$${salaryMax.toLocaleString()}`;
  }
  if (salaryMin !== null) return `From $${salaryMin.toLocaleString()}`;
  if (salaryMax !== null) return `Up to $${salaryMax.toLocaleString()}`;
  return "";
}

interface BuiltMutation {
  payload: Record<string, unknown>;
  artifact: PendingActionArtifact;
}

// ── draft_job_post ───────────────────────────────────────────────────────────
// `priorRawInput` is the still-pending card's OWN stored tool-call input (not
// the built payload) — Fix Round 4, Section A. A chat correction in a NEW
// conversation (the executor's id-less upsert path, lib/assistant-tools.ts)
// restates only what changed (e.g. just the missing pay fields), never the
// whole call — so a field this call omits (location, pay_range, hours, an
// earlier salary figure) must still come from the LAST call that set it,
// never silently blank out. `{ ...priorRawInput, ...input }` is exactly that:
// new keys win, omitted keys fall back. Omitted entirely (a fresh draft)
// defaults to empty, so a first-time call is unaffected. The merged input is
// itself stored back on `payload.rawInput` so the NEXT correction (or this
// same resolution, called with `pending_action_id` instead) has it to merge
// against in turn.
export async function buildDraftJobPostArtifact(input: Record<string, unknown>, priorRawInput: Record<string, unknown> = {}): Promise<BuiltMutation> {
  const merged: Record<string, unknown> = { ...priorRawInput, ...input };
  delete merged.pending_action_id;
  // pending_draft_title (Fix Round 5, Section B) is targeting-only — which
  // pending row to upsert into — never a job field, so it's stripped before
  // anything below reads `merged` as the job's own data.
  delete merged.pending_draft_title;
  const roleDescription = str(merged.role_description).trim();
  if (roleDescription.length < 10) throw new Error("role_description must be the full job post text you've composed (at least 10 characters).");
  const title = (str(merged.title).trim() || firstLine(roleDescription) || "Untitled role").slice(0, 200);
  const location = str(merged.location).trim();
  const payRange = str(merged.pay_range).trim();
  const hours = str(merged.hours).trim();
  const publish = merged.publish === true;
  // Structured pay fields — needed for the SAME pay-transparency + board-quality
  // gate the hand-driven jobs route enforces (lib/job-publish-validation.ts).
  // `pay_range` stays free text for display; these are what the gate actually reads.
  const salaryMin = num(merged.salary_min);
  const salaryMax = num(merged.salary_max);
  const benefitsDescription = str(merged.benefits_description).trim();

  const extras: string[] = [];
  if (payRange) extras.push(`Pay range: ${payRange}`);
  if (hours) extras.push(`Hours: ${hours}`);
  const description = extras.length ? `${roleDescription}\n\n${extras.join("\n")}` : roleDescription;

  const payload = { title, description, location, publish, salaryMin, salaryMax, benefitsDescription, rawInput: merged };
  // Checked here too (not just at approval) so the employer sees the SAME
  // rejection the hand route would give BEFORE approving, not only after —
  // the card is still created either way; approving a blocked one simply
  // fails with the identical message (see executeDraftJobPost).
  const violation = publish
    ? jobPublishViolation({ status: "active", publicListed: true, title, description, location, salaryMin, salaryMax, benefitsDescription })
    : null;
  // Fix Round 6, Section B: the card must always render the complete current
  // field set — not just whatever changed in the LAST correction. A blocked
  // card corrected to add the missing wage must show that wage, every time
  // this function runs, fresh draft or update alike (it's the same function
  // either way, so there is no separate "updated card" code path to drift
  // out of parity with a fresh one).
  const payDisplay = formatPayRangeDisplay(payRange, salaryMin, salaryMax);
  const artifact: PendingActionArtifact = {
    title: publish ? (violation ? "Post a new job — can't publish yet" : "Post a new job — will be published") : "Draft a new job posting",
    irreversible: false,
    resolvedSpecifics: [
      { label: "Title", value: title },
      ...(location ? [{ label: "Location", value: location }] : []),
      ...(payDisplay ? [{ label: "Pay range", value: payDisplay }] : []),
      ...(hours ? [{ label: "Hours", value: hours }] : []),
      ...(benefitsDescription ? [{ label: "Benefits", value: benefitsDescription }] : []),
      { label: "Visibility", value: publish ? "Published — live on the public job board" : "Draft — not published" },
      ...(violation ? [{ label: "⚠ Can't publish yet", value: violation.message }] : []),
    ],
    items: [{ id: "job", artifact: `${title}${location ? ` — ${location}` : ""}\n\n${description}` }],
  };
  return { payload, artifact };
}

async function executeDraftJobPost(employerId: string, payload: Record<string, unknown>, access: Access | null = null): Promise<ExecutionResult> {
  // ONE JOB POST EVER (Free plan, Section E.4) — re-checked here, the one
  // moment this can actually create a row, not just at draft time in
  // lib/assistant-explainer.ts (which only guards Taylor's OWN one-shot
  // flow). `access` is null only when a caller doesn't pass one through;
  // treated as "not Free" rather than guessed, so this never blocks a paid
  // employer's approval just because a caller forgot to thread access.
  if (access) {
    const tier = access.isAdmin ? "corporate" : access.tier || "free";
    const freeState = await getFreeTierState(employerId);
    const gate = gradeGate(tier, "job_create", "You've already posted your one free job", jobCreateAllowed(freeState.jobsCount));
    if (!gate.allowed) return { ok: false, reason: gate.message };
  }
  const p = payload as {
    title: string;
    description: string;
    location: string;
    publish: boolean;
    salaryMin: number | null;
    salaryMax: number | null;
    benefitsDescription: string;
    // Set only when this draft came from start_job_from_playbook (Prompt 5,
    // lib/assistant-tools.ts) — absent (undefined) for a freehand
    // draft_job_post, in which case createJob below leaves both columns
    // untouched exactly as before this prompt.
    screeningQuestions?: string[];
    interviewKit?: InterviewKitContent;
  };
  // Re-checked at approval time, exactly like every other mutation's
  // precondition re-check — the one moment this can actually go live.
  if (p.publish) {
    const violation = jobPublishViolation({
      status: "active",
      publicListed: true,
      title: p.title,
      description: p.description,
      location: p.location,
      salaryMin: p.salaryMin,
      salaryMax: p.salaryMax,
      benefitsDescription: p.benefitsDescription,
    });
    if (violation) return { ok: false, reason: violation.message };
  }
  const job = await createJob(employerId, {
    title: p.title,
    description: p.description,
    location: p.location,
    status: p.publish ? "active" : "draft",
    publicListed: !!p.publish,
    salaryMin: p.salaryMin,
    salaryMax: p.salaryMax,
    benefitsDescription: p.benefitsDescription,
    screeningQuestions: p.screeningQuestions,
    // The FIRST time a job goes active+public (migration 0071) — Google Jobs
    // markup's datePosted and the default 30-day validThrough both derive
    // from this (lib/job-posting-lifecycle.ts computeValidThrough).
    publishedAt: p.publish ? new Date().toISOString() : undefined,
  });
  if (!job) return { ok: false, reason: "Could not create the job posting. Please try again from the portal." };
  if (access && !access.isAdmin && (access.tier || "free") === "free") await incrementJobsCount(employerId);
  // Prompt 5: a playbook-seeded draft carries its own interview kit — store
  // it the moment the job itself exists (there's no job_id to attach it to
  // before this line). A freehand draft_job_post never sets `interviewKit`,
  // so this is a no-op for every pre-Prompt-5 call.
  if (p.interviewKit && p.interviewKit.questions?.length) {
    await saveInterviewKit(employerId, job.id, p.interviewKit, "playbook");
  }
  // Fix Round 4, Section A: a leftover pending draft_job_post this one never
  // got corrected into (predates the id-less upsert, or two were drafted
  // before it existed) must not sit there forever, approvable into a SECOND
  // job later — cancel every other still-pending draft_job_post row now that
  // this one has gone live. `jobId` is null for every draft_job_post payload
  // (there's no job until this line), so "the same job+action" here means
  // every other in-flight draft, matching the id-less upsert's own key.
  await cancelSiblingPending(employerId, "draft_job_post", null, "superseded");
  return { ok: true, targetType: "job", targetId: job.id };
}

// ── publish_job (Fix Round 2, Section C) ────────────────────────────────────
// draft_job_post always creates a NEW job — it is the wrong tool for "publish
// job 15" (an EXISTING job, already sitting as a draft from the hand-driven
// form or an earlier draft_job_post approval). Before this tool existed, a
// request like that had no deterministic path: the model either chatted
// about it without calling a tool, or called draft_job_post again and
// created a DUPLICATE job rather than publishing the one the employer meant
// (the Oct 23 defect this section fixes). publish_job instead loads the
// EXISTING row by id, applies any field_updates in memory, and runs through
// the exact same card → approve → execute pipeline as every other mutation —
// `executePublishJob` below calls `updateJob`, never `createJob`, so the job
// id is constant end to end no matter how many times a card is corrected.
export interface JobFieldUpdates {
  title?: string;
  location?: string;
  department?: string;
  description?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  benefitsDescription?: string;
}

function extractJobFieldUpdates(v: unknown): JobFieldUpdates {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const out: JobFieldUpdates = {};
  if (typeof o.title === "string" && o.title.trim()) out.title = o.title.trim().slice(0, 200);
  if (typeof o.location === "string") out.location = o.location.trim();
  if (typeof o.department === "string") out.department = o.department.trim();
  if (typeof o.description === "string" && o.description.trim()) out.description = o.description.trim();
  if (o.salary_min !== undefined) {
    const n = num(o.salary_min);
    if (n !== null) out.salaryMin = n;
  }
  if (o.salary_max !== undefined) {
    const n = num(o.salary_max);
    if (n !== null) out.salaryMax = n;
  }
  if (typeof o.benefits_description === "string") out.benefitsDescription = o.benefits_description.trim();
  return out;
}

/** The job's fields as they will be AFTER `updates` is applied — what the
 *  card previews and what the shared validator checks, both before and at
 *  approval time. */
function effectiveJobFields(job: { title: string; location: string; description: string; salaryMin: number | null; salaryMax: number | null; benefitsDescription: string }, updates: JobFieldUpdates) {
  return {
    title: updates.title !== undefined ? updates.title : job.title,
    location: updates.location !== undefined ? updates.location : job.location,
    description: updates.description !== undefined ? updates.description : job.description,
    salaryMin: updates.salaryMin !== undefined ? updates.salaryMin : job.salaryMin,
    salaryMax: updates.salaryMax !== undefined ? updates.salaryMax : job.salaryMax,
    benefitsDescription: updates.benefitsDescription !== undefined ? updates.benefitsDescription : job.benefitsDescription,
  };
}

/** `priorUpdates` is the still-pending card's OWN stored updates (not the
 *  job's saved fields) — when a chat correction only mentions the ONE field
 *  that was wrong (e.g. "the benefits are health insurance and a 401(k)"),
 *  a PRIOR correction's fields (e.g. the wage range supplied a turn earlier)
 *  must not be dropped just because this call didn't repeat them. Omitted
 *  (fresh draft) defaults to empty, so a first-time publish_job call is
 *  unaffected. */
export async function buildPublishJobArtifact(employerId: string, input: Record<string, unknown>, priorUpdates: JobFieldUpdates = {}): Promise<BuiltMutation> {
  const jobId = num(input.job_id);
  if (jobId === null) throw new Error("job_id is required — look up the job first (e.g. with get_jobs) if you don't already have its id.");
  const job = await getJob(employerId, jobId);
  if (!job) throw new Error("That job posting could not be found.");

  const updates = { ...priorUpdates, ...extractJobFieldUpdates(input.field_updates) };
  const effective = effectiveJobFields(job, updates);

  // Checked here too (not just at approval) so the card shows the SAME
  // rejection the hand route would give BEFORE approving — see
  // executePublishJob for the re-check at approval time.
  const violation = jobPublishViolation({
    status: "active",
    publicListed: true,
    title: effective.title,
    description: effective.description,
    location: effective.location,
    salaryMin: effective.salaryMin,
    salaryMax: effective.salaryMax,
    benefitsDescription: effective.benefitsDescription,
  });

  const payload = { jobId, updates };
  // Fix Round 6, Section B: same completeness rule as draft_job_post — the
  // card always shows the CURRENT effective wage/benefits, not just what a
  // correction changed, so a wage added via field_updates is actually
  // visible before approval rather than only passing the (invisible) gate.
  const payDisplay = formatPayRangeDisplay("", effective.salaryMin, effective.salaryMax);
  const artifact: PendingActionArtifact = {
    title: violation ? `Publish "${effective.title}" — can't publish yet` : `Publish "${effective.title}"`,
    irreversible: false,
    blocked: !!violation,
    resolvedSpecifics: [
      { label: "Job", value: effective.title },
      ...(effective.location ? [{ label: "Location", value: effective.location }] : []),
      ...(payDisplay ? [{ label: "Pay range", value: payDisplay }] : []),
      ...(effective.benefitsDescription ? [{ label: "Benefits", value: effective.benefitsDescription }] : []),
      { label: "Visibility", value: violation ? "Blocked — not published yet" : "Will be published — live on the public job board" },
      ...(violation ? [{ label: "⚠ Can't publish yet", value: violation.message }] : []),
    ],
    items: [{ id: String(jobId), artifact: `${effective.title}${effective.location ? ` — ${effective.location}` : ""}\n\n${effective.description}` }],
  };
  return { payload, artifact };
}

async function executePublishJob(employerId: string, payload: Record<string, unknown>, access: Access | null = null): Promise<ExecutionResult> {
  const p = payload as { jobId: number; updates: JobFieldUpdates };
  const job = await getJob(employerId, p.jobId);
  if (!job) return { ok: false, reason: "That job posting no longer exists." };

  // EDIT RULE (Free plan, Section E.4): title + role category lock once
  // published; a closed post only reactivates AS IS; a substantial
  // description rewrite reads as a new role. Same gate the hand-driven PATCH
  // route runs, re-checked here because this is the one moment this tool
  // can actually change the job.
  if (access) {
    const tier = access.isAdmin ? "corporate" : access.tier || "free";
    const changedPatch: { title?: string; department?: string; description?: string; status?: string } = { status: "active" };
    if (p.updates.title !== undefined && p.updates.title !== job.title) changedPatch.title = p.updates.title;
    if (p.updates.department !== undefined && p.updates.department !== job.department) changedPatch.department = p.updates.department;
    if (p.updates.description !== undefined && p.updates.description !== job.description) changedPatch.description = p.updates.description;
    const gate = checkFreeJobEdit({
      tier,
      status: job.status,
      title: job.title,
      department: job.department,
      description: job.description,
      publishedAt: job.publishedAt ?? null,
      patch: changedPatch,
    });
    if (!gate.allowed) return { ok: false, reason: gate.message };
  }

  // Re-checked at approval time, exactly like draft_job_post's publish path —
  // the one moment this can actually go live.
  const effective = effectiveJobFields(job, p.updates);
  const violation = jobPublishViolation({
    status: "active",
    publicListed: true,
    title: effective.title,
    description: effective.description,
    location: effective.location,
    salaryMin: effective.salaryMin,
    salaryMax: effective.salaryMax,
    benefitsDescription: effective.benefitsDescription,
  });
  if (violation) return { ok: false, reason: violation.message };

  // updateJob — NEVER createJob — so this always acts on the SAME job id the
  // card named, however many times it was corrected first. publishedAt is
  // stamped only the FIRST time (migration 0071) — a job already published
  // once keeps its original publishedAt even if it's republished later.
  const ok = await updateJob(employerId, p.jobId, {
    ...p.updates,
    status: "active",
    publicListed: true,
    publishedAt: job.publishedAt ? undefined : new Date().toISOString(),
  });
  if (!ok) return { ok: false, reason: "Could not publish this job posting. Please try again from the portal." };
  // Fix Round 4, Section A: same reasoning as executeDraftJobPost — a
  // leftover pending publish_job card for this SAME job (pre-fix, or never
  // corrected into the one just approved) must not remain approvable after
  // the job is already live, or two approvals could race to "publish" it.
  await cancelSiblingPending(employerId, "publish_job", p.jobId, "superseded");
  return { ok: true, targetType: "job", targetId: p.jobId };
}

// ── distribute_job (Job Distribution, Kimi prompt v3; ZipRecruiter channel
// added as an additive sibling of the Indeed feed) ──────────────────────────
// Per-job employer approval for the Indeed XML feed, the ZipRecruiter XML
// feed, and the LinkedIn share/partner artifacts (Scale+, Marvin's ruling
// 2). Google Jobs is deliberately NOT a channel here — ruling 1 makes it
// automatic on every public listing at every tier
// (lib/job-posting-lifecycle.ts), so the card only ever lists it as
// informational. None of Indeed, ZipRecruiter, or LinkedIn has an open
// posting API (ruling 3/4): approving this NEVER claims a job is "posted to"
// any of them — see lib/job-distribution.ts's own header for why that
// wording is banned end to end.
export async function buildDistributeJobArtifact(employerId: string, input: Record<string, unknown>): Promise<BuiltMutation> {
  const jobId = num(input.job_id);
  if (jobId === null) throw new Error("job_id is required — look up the job first (e.g. with get_jobs) if you don't already have its id.");
  const job = await getJob(employerId, jobId);
  if (!job) throw new Error("That job posting could not be found.");
  if (!isJobCurrentlyPublic(job)) {
    throw new Error("This job must be published and publicly listed before it can be distributed to Indeed, ZipRecruiter, or LinkedIn — publish it first (e.g. with publish_job).");
  }
  const wantIndeed = input.indeed_feed === true;
  const wantZipRecruiter = input.zip_recruiter === true;
  const wantLinkedIn = input.linkedin === true;
  if (!wantIndeed && !wantZipRecruiter && !wantLinkedIn) throw new Error("Pick at least one channel — indeed_feed, zip_recruiter, and/or linkedin.");

  const existing = await getDistribution(employerId, jobId);
  const channels = buildChannelsFromInput({ indeedFeed: wantIndeed, linkedin: wantLinkedIn, zipRecruiter: wantZipRecruiter }, existing?.channels || null);

  const profile = await getEmployerProfile(employerId);
  const companyName = profile?.companyName || "your company";
  const jobUrl = appUrl(`/jobs/${jobId}`);

  const items: PendingActionArtifact["items"] = [];
  // Indeed and ZipRecruiter share the same employer feed token (it's
  // channel-agnostic — see buildZipRecruiterFeedUrl's own comment), so one
  // fetch covers both rather than resolving/creating it twice.
  const feedToken = channels.indeedFeed?.enabled || channels.zipRecruiter?.enabled ? await ensureEmployerFeedToken(employerId) : null;
  if (channels.indeedFeed?.enabled) {
    const feedUrl = feedToken ? buildIndeedFeedUrl(appUrl(), feedToken) : "";
    items.push({
      id: "indeed_feed",
      label: "Indeed XML feed — submission to Indeed required",
      artifact: feedUrl ? buildIndeedFeedInstructions(feedUrl) : "Could not generate your feed URL — try approving again.",
    });
  }
  if (channels.zipRecruiter?.enabled) {
    const feedUrl = feedToken ? buildZipRecruiterFeedUrl(appUrl(), feedToken) : "";
    items.push({
      id: "zip_recruiter_feed",
      label: "ZipRecruiter XML feed — submission to ZipRecruiter required",
      artifact: feedUrl ? buildZipRecruiterFeedInstructions(feedUrl) : "Could not generate your feed URL — try approving again.",
    });
  }
  if (channels.linkedin?.enabled) {
    const utmUrl = addUtm(jobUrl, "linkedin");
    items.push({ id: "linkedin_share", label: "LinkedIn share link — post it yourself", artifact: `${buildLinkedInShareUrl(utmUrl)}\n\n${buildLinkedInShareCopy(job.title, companyName, utmUrl)}` });
    items.push({ id: "linkedin_partner", label: "LinkedIn partner application — for future direct posting", artifact: buildLinkedInPartnerInstructions() });
  }

  const payload = { jobId, channels };
  const resolvedSpecifics: PendingActionArtifact["resolvedSpecifics"] = [
    { label: "Job", value: job.title },
    { label: "Google Jobs", value: "Automatic — included with every public listing, no approval needed." },
    { label: "Indeed", value: channels.indeedFeed?.enabled ? "Feed submission generated below" : "Not selected" },
    { label: "ZipRecruiter", value: channels.zipRecruiter?.enabled ? "Feed submission generated below" : "Not selected" },
    { label: "LinkedIn", value: channels.linkedin?.enabled ? "Share link generated below" : "Not selected" },
  ];
  // Distribution Fix 2: turning the Indeed feed on for a job whose location
  // string won't parse into city/state/country gets flagged on the card
  // itself, not just on a later get_distribution_status lookup. ZipRecruiter
  // needs the same city+state, so its own channel gets the same treatment.
  if (channels.indeedFeed?.enabled && parseFeedLocation(job.location).unparseable) {
    resolvedSpecifics!.push({ label: "Indeed visibility", value: FEED_LOCATION_UNPARSEABLE_NOTICE });
  }
  if (channels.zipRecruiter?.enabled && parseFeedLocation(job.location).unparseable) {
    resolvedSpecifics!.push({ label: "ZipRecruiter visibility", value: FEED_LOCATION_UNPARSEABLE_NOTICE_ZIPRECRUITER });
  }
  const artifact: PendingActionArtifact = {
    title: `Distribute "${job.title}" beyond ResumeTailored`,
    irreversible: false,
    resolvedSpecifics,
    items,
  };
  return { payload, artifact };
}

async function executeDistributeJob(employerId: string, actorUserId: string, actorEmail: string | null, payload: Record<string, unknown>): Promise<ExecutionResult> {
  const p = payload as { jobId: number; channels: DistributionChannels };
  const job = await getJob(employerId, p.jobId);
  if (!job) return { ok: false, reason: "That job posting no longer exists." };
  if (!isJobCurrentlyPublic(job)) return { ok: false, reason: "This job is no longer published and publicly listed, so it can't be distributed." };
  const row = await upsertDistribution(employerId, p.jobId, p.channels, actorUserId, actorEmail);
  if (!row) return { ok: false, reason: "Could not save this distribution. Please try again." };
  return { ok: true, targetType: "job", targetId: p.jobId };
}

// ── move_candidates ──────────────────────────────────────────────────────────
export async function buildMoveCandidatesArtifact(employerId: string, input: Record<string, unknown>): Promise<BuiltMutation> {
  const jobId = num(input.job_id);
  if (jobId === null) throw new Error("job_id is required.");
  const toStage = str(input.to_stage).trim();
  if (!isApplicantStatus(toStage)) throw new Error(`to_stage must be one of: ${APPLICANT_STATUSES.join(", ")}.`);
  const ids = numArray(input.candidate_ids);
  if (!ids.length) throw new Error("candidate_ids is required.");

  const job = await getJob(employerId, jobId);
  if (!job) throw new Error("That job posting could not be found.");

  const resolved: { id: number; name: string; fromStage: ApplicantStatus }[] = [];
  for (const id of ids) {
    const applicant = await getApplicant(employerId, id);
    if (!applicant || applicant.jobId !== jobId) throw new Error(`Candidate ${id} could not be found on this job — look up the candidate list again.`);
    resolved.push({ id: applicant.id, name: applicant.name, fromStage: applicant.status });
  }

  const payload = { jobId, toStage, candidates: resolved.map((r) => ({ id: r.id, expectedFromStage: r.fromStage })) };
  const artifact: PendingActionArtifact = {
    title: resolved.length === 1 ? `Move ${resolved[0].name} to ${toStage}` : `Move ${resolved.length} candidates to ${toStage}`,
    irreversible: false,
    resolvedSpecifics: [
      { label: "Job", value: job.title },
      { label: "To", value: toStage },
    ],
    items: resolved.map((r) => ({ id: String(r.id), label: r.name, artifact: `${r.name}: ${r.fromStage} → ${toStage}` })),
  };
  return { payload, artifact };
}

async function executeMoveCandidates(employerId: string, payload: Record<string, unknown>): Promise<ExecutionResult> {
  const p = payload as { jobId: number; toStage: ApplicantStatus; candidates: { id: number; expectedFromStage: ApplicantStatus }[] };
  const job = await getJob(employerId, p.jobId);
  if (!job) return { ok: false, reason: "That job posting no longer exists." };

  // All-or-nothing precondition re-check: a candidate who moved since this
  // card was drafted means nothing in this batch moves — never a partial,
  // silent act on stale state (docs/assistant-confirmation-card.md).
  for (const c of p.candidates) {
    const applicant = await getApplicant(employerId, c.id);
    if (!applicant) return { ok: false, reason: "A candidate in this batch is no longer available — nothing was moved." };
    if (applicant.status !== c.expectedFromStage) {
      return {
        ok: false,
        reason: `${applicant.name} is now "${applicant.status}" — that changed since this was drafted, so nothing in this batch was moved. Ask me again to move the current list.`,
      };
    }
  }
  for (const c of p.candidates) {
    const ok = await updateApplicant(employerId, c.id, { status: p.toStage });
    if (!ok) return { ok: false, reason: "Could not update one of the candidates. Please try again from the portal." };
  }
  return { ok: true, targetType: "job", targetId: p.jobId };
}

// ── schedule_interviews ──────────────────────────────────────────────────────
function interviewOverlaps(scheduledAtIso: string, durationMin: number, slotStart: number, slotEnd: number): boolean {
  const s = new Date(scheduledAtIso).getTime();
  if (!Number.isFinite(s)) return false;
  const e = s + Math.max(5, durationMin || 30) * 60_000;
  return s < slotEnd && e > slotStart;
}

export async function buildScheduleInterviewsArtifact(employerId: string, input: Record<string, unknown>): Promise<BuiltMutation> {
  const jobId = num(input.job_id);
  if (jobId === null) throw new Error("job_id is required.");
  const scheduledAtMs = new Date(str(input.scheduled_at)).getTime();
  if (!Number.isFinite(scheduledAtMs)) throw new Error("scheduled_at must be a valid ISO-8601 date/time.");
  const scheduledAt = new Date(scheduledAtMs).toISOString();
  const durationMin = num(input.duration_min) ?? 30;
  const mode = isInterviewMode(input.mode) ? input.mode : "video";
  const ids = numArray(input.candidate_ids);
  if (!ids.length) throw new Error("candidate_ids is required.");

  const job = await getJob(employerId, jobId);
  if (!job) throw new Error("That job posting could not be found.");

  const employerTz = await getEmployerTimezone(employerId);
  const existing = await listInterviews(employerId, { status: "scheduled" });
  const slotStart = scheduledAtMs;
  const slotEnd = scheduledAtMs + durationMin * 60_000;

  const resolved: { id: number; name: string; clash: string | null }[] = [];
  for (const id of ids) {
    const applicant = await getApplicant(employerId, id);
    if (!applicant || applicant.jobId !== jobId) throw new Error(`Candidate ${id} could not be found on this job.`);
    const own = existing.find((iv) => iv.applicantId === id && interviewOverlaps(iv.scheduledAt, iv.durationMin, slotStart, slotEnd));
    const other = !own ? existing.find((iv) => iv.applicantId !== id && interviewOverlaps(iv.scheduledAt, iv.durationMin, slotStart, slotEnd)) : null;
    const clash = own
      ? `${applicant.name} already has an interview at this time ("${own.title}").`
      : other
        ? `This time overlaps another interview already on the calendar ("${other.title}"${other.applicantName ? ` with ${other.applicantName}` : ""}).`
        : null;
    resolved.push({ id: applicant.id, name: applicant.name, clash });
  }

  const payload = { jobId, scheduledAt, durationMin, mode, candidates: resolved.map((r) => ({ id: r.id })) };
  const artifact: PendingActionArtifact = {
    title: resolved.length === 1 ? `Schedule an interview with ${resolved[0].name}` : `Schedule interviews with ${resolved.length} candidates`,
    irreversible: false,
    resolvedSpecifics: [
      { label: "Job", value: job.title },
      { label: "When", value: formatEmployerTime(scheduledAt, employerTz) },
      { label: "Duration", value: `${durationMin} min` },
      { label: "Mode", value: mode },
    ],
    items: resolved.map((r) => ({
      id: String(r.id),
      label: r.name,
      artifact: `${r.name} — ${mode} interview, ${formatEmployerTime(scheduledAt, employerTz)} (${durationMin} min)${r.clash ? `\n⚠ ${r.clash}` : ""}`,
    })),
  };
  return { payload, artifact };
}

async function executeScheduleInterviews(employerId: string, actorUserId: string, payload: Record<string, unknown>): Promise<ExecutionResult> {
  const p = payload as { jobId: number; scheduledAt: string; durationMin: number; mode: "video" | "phone" | "onsite"; candidates: { id: number }[] };
  const job = await getJob(employerId, p.jobId);
  if (!job) return { ok: false, reason: "That job posting no longer exists." };

  // Precondition re-check (candidate still on this job) before touching anything.
  for (const c of p.candidates) {
    const applicant = await getApplicant(employerId, c.id);
    if (!applicant || applicant.jobId !== p.jobId) return { ok: false, reason: "A candidate in this batch is no longer on that job — nothing was scheduled." };
  }
  for (const c of p.candidates) {
    const interview = await createInterview(employerId, {
      applicantId: c.id,
      jobId: p.jobId,
      title: `Interview — ${job.title}`,
      scheduledAt: p.scheduledAt,
      durationMin: p.durationMin,
      mode: p.mode,
    });
    if (!interview) return { ok: false, reason: "Could not schedule one of the interviews. Please try again from the portal." };
    notifyCandidateOfInterview(employerId, interview, "scheduled").catch(() => {});
    notifyInterviewerOfInterview(employerId, actorUserId, interview).catch(() => {});
  }
  return { ok: true, targetType: "job", targetId: p.jobId };
}

// ── message_candidates ───────────────────────────────────────────────────────
// Language registry (Prompt 5 — Spanish-first multilingual drafting):
// supported message_candidates languages, built so adding one more is a
// single new entry here, nothing else. `en` needs no gloss (it IS the
// language the employer reads); every other entry requires one — see the
// APPROVE-WHAT-YOU-SEE rule below.
export const ASSISTANT_MESSAGE_LANGUAGES: Record<string, { label: string }> = {
  en: { label: "English" },
  es: { label: "Spanish" },
};

function cleanMessageLanguage(v: unknown): string {
  const s = str(v).trim().toLowerCase();
  return s && ASSISTANT_MESSAGE_LANGUAGES[s] ? s : "en";
}

export async function buildMessageCandidatesArtifact(employerId: string, input: Record<string, unknown>): Promise<BuiltMutation> {
  const message = str(input.message).trim();
  if (message.length < 2) throw new Error("message is required — write the full message body.");
  const language = cleanMessageLanguage(input.language);
  const glossEn = str(input.gloss_en).trim();
  // APPROVE-WHAT-YOU-SEE RULE: an employer approving a message they can't
  // read isn't approval — a non-English draft MUST carry a faithful English
  // back-translation the card shows alongside the real message, so what's
  // approved is exactly what the employer actually reads and understands.
  if (language !== "en" && glossEn.length < 2) {
    throw new Error(
      "gloss_en is required when language is not 'en' — write a complete, faithful English back-translation of the exact message you composed (never omitting a detail like pay, dates, or conditions), so the employer can see exactly what they're approving."
    );
  }

  let targets: Applicant[] = [];
  const ids = numArray(input.candidate_ids);
  if (ids.length) {
    for (const id of ids) {
      const a = await getApplicant(employerId, id);
      if (!a) throw new Error(`Candidate ${id} could not be found.`);
      targets.push(a);
    }
  } else if (input.filter && typeof input.filter === "object") {
    const f = input.filter as Record<string, unknown>;
    const jobId = num(f.job_id);
    if (jobId === null) throw new Error("filter.job_id is required when candidate_ids is omitted.");
    const status = str(f.status);
    const list = await listApplicants(employerId, { jobId });
    targets = status ? list.filter((a) => a.status === status) : list;
    if (!targets.length) throw new Error("No candidates matched that filter — nothing to message.");
  } else {
    throw new Error("Provide candidate_ids or a filter ({ job_id, status? }) to pick candidates.");
  }

  const payload = { candidates: targets.map((a) => ({ id: a.id })), message, language, glossEn: language === "en" ? "" : glossEn };
  const languageLabel = ASSISTANT_MESSAGE_LANGUAGES[language].label;
  const artifact: PendingActionArtifact = {
    title: targets.length === 1 ? `Send a message to ${targets[0].name}` : `Send a message to ${targets.length} candidates`,
    irreversible: true,
    irreversibleLabel: "This can't be unsent once it sends — you'll have a short window to undo right after approving.",
    resolvedSpecifics: [
      { label: "Recipients", value: targets.map((a) => a.name).join(", ") },
      ...(language !== "en" ? [{ label: "Language", value: languageLabel }] : []),
    ],
    items: targets.map((a) => {
      const rendered = personalize(message, a);
      if (language === "en") return { id: String(a.id), label: a.name, artifact: rendered };
      // Both clearly labeled, the gloss explicitly marked as not what sends —
      // the card must show exactly what the APPROVE-WHAT-YOU-SEE rule above requires.
      const gloss = personalize(glossEn, a);
      return {
        id: String(a.id),
        label: a.name,
        artifact: `Message (${languageLabel}) — what will be sent:\n${rendered}\n\nEnglish gloss — for your review only, not sent:\n${gloss}`,
      };
    }),
  };
  return { payload, artifact };
}

async function executeMessageCandidates(employerId: string, pendingActionId: string, payload: Record<string, unknown>): Promise<ExecutionResult> {
  const p = payload as { candidates: { id: number }[]; message: string };
  const applicants: Applicant[] = [];
  for (const c of p.candidates) {
    const a = await getApplicant(employerId, c.id);
    if (!a) return { ok: false, reason: "A candidate in this batch is no longer available — nothing was queued." };
    applicants.push(a);
  }
  const sendAt = new Date(Date.now() + ASSISTANT_UNDO_WINDOW_SECONDS * 1000).toISOString();
  for (const a of applicants) {
    const body = personalize(p.message, a);
    const row = await enqueueSend({ pendingActionId, employerId, candidateId: a.id, body, sendAt });
    if (!row) return { ok: false, reason: "Could not queue one of the messages. Please try again from the portal." };
  }
  return { ok: true, targetType: null, targetId: null };
}

// ── set_ack_template (Prompt 4 — standing auto-application-acknowledgment) ──
// The one exception to "every mutation targets a resolved set of candidates
// right now": this one has no candidates at all yet — it approves a POLICY
// (lib/assistant-ack-settings.ts) that lib/assistant-ack-worker.ts applies to
// every matching FUTURE applicant, with zero further approvals per message.
// The card still goes through the identical pending-action pipeline as every
// other mutation (same confirmation, same audit trail on approval) — only
// what gets stored on approval differs.
export async function buildSetAckTemplateArtifact(employerId: string, input: Record<string, unknown>): Promise<BuiltMutation> {
  const template = str(input.template).trim();
  if (template.length < 2) throw new Error("template is required — write the full acknowledgment message.");
  const jobId = input.job_id === undefined || input.job_id === null || input.job_id === "" ? null : num(input.job_id);
  let jobTitle = "";
  if (jobId !== null) {
    const job = await getJob(employerId, jobId);
    if (!job) throw new Error("That job posting could not be found.");
    jobTitle = job.title;
  }
  // The card must render the FULL body sendEmail will actually deliver —
  // greeting + template + sign-off/footer — not the bare template, so
  // approving the card really is approving what sends (Prompt 5a). There is
  // no real applicant yet for a standing template, so the greeting previews
  // with the literal `{{firstName}}` placeholder, same as the template
  // itself may contain.
  const profile = await getEmployerProfile(employerId);
  const wrappedPreview = renderAckEmailPlainText(ackEmailParts("{{firstName}}", template, profile?.companyName || ""));
  const payload = { jobId, template };
  const artifact: PendingActionArtifact = {
    title: jobId !== null ? `Set a standing acknowledgment for ${jobTitle}` : "Set a standing acknowledgment for every new application",
    irreversible: true,
    irreversibleLabel: "Once approved, this fires automatically on every new application — no further approval per message. Editing it later requires approving a new version the same way.",
    resolvedSpecifics: [{ label: "Scope", value: jobId !== null ? `Job-specific — ${jobTitle}` : "Account-wide — every job" }],
    items: [{ id: "ack-template", artifact: wrappedPreview }],
  };
  return { payload, artifact };
}

async function executeSetAckTemplate(employerId: string, actorUserId: string, actorEmail: string | null, payload: Record<string, unknown>): Promise<ExecutionResult> {
  const p = payload as { jobId: number | null; template: string };
  const row = await createAckSetting({ employerId, jobId: p.jobId, template: p.template, actorUserId, actorEmail });
  if (!row) return { ok: false, reason: "Could not save this template. Please try again from the portal." };
  return { ok: true, targetType: p.jobId !== null ? "job" : null, targetId: p.jobId };
}

export interface DisableAckTemplateResult {
  jobId: number | null;
  disabled: boolean;
  message: string;
}

/** Turning a standing acknowledgment OFF skips the confirmation-card
 *  pipeline entirely (Prompt 5b): removing a future send is strictly safer
 *  than adding one, so it takes effect the instant the employer asks, with
 *  no approval and no pending-action row. Targets the EXACT scope asked for
 *  (job-specific vs account-wide) via `getActiveAckSettingForScope` — never
 *  the job-specific-beats-account-wide cascade `getActiveAckSetting` uses
 *  for resolving which template actually fires, which would risk disabling
 *  the wrong one. A scope with nothing active to disable is reported back
 *  (not an error) so the model can tell the employer plainly. Re-enabling or
 *  changing the TEXT of a template is NOT handled here — that always goes
 *  back through the normal set_ack_template card (lib/assistant-tools.ts). */
export async function disableSetAckTemplate(employerId: string, input: Record<string, unknown>): Promise<DisableAckTemplateResult> {
  const jobId = input.job_id === undefined || input.job_id === null || input.job_id === "" ? null : num(input.job_id);
  let jobTitle = "";
  if (jobId !== null) {
    const job = await getJob(employerId, jobId);
    if (!job) throw new Error("That job posting could not be found.");
    jobTitle = job.title;
  }
  const active = await getActiveAckSettingForScope(employerId, jobId);
  if (!active) {
    return {
      jobId,
      disabled: false,
      message: jobId !== null ? `There's no active standing acknowledgment for ${jobTitle} to turn off.` : "There's no active account-wide standing acknowledgment to turn off.",
    };
  }
  const ok = await setAckSettingEnabled(employerId, active.id, false);
  if (!ok) throw new Error("Could not disable this template. Please try again from the portal.");
  return {
    jobId,
    disabled: true,
    message: jobId !== null ? `Turned off the standing acknowledgment for ${jobTitle}.` : "Turned off the account-wide standing acknowledgment.",
  };
}

// ── add_job_faq (Prompt 6, Section 1 — Candidate Q&A, FAQ content) ─────────
// Adds/edits the employer-approved FAQ for one job. Every call — a brand-new
// FAQ or an edit to an existing one — goes through a fresh pending-action
// approval ("Edit of FAQ content = fresh approval"); there is no in-place
// silent edit of already-approved content. This is deliberately separate
// from enabling Q&A itself (below): adding FAQ content never flips the
// enable switch either way.
function extractQaPairs(v: unknown): JobFaqPair[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((p) => {
      if (!p || typeof p !== "object") return null;
      const r = p as Record<string, unknown>;
      const question = str(r.question).trim();
      const answer = str(r.answer).trim();
      if (!question || !answer) return null;
      return { question: question.slice(0, 500), answer: answer.slice(0, 2000) };
    })
    .filter((p): p is JobFaqPair => p !== null);
}

export async function buildAddJobFaqArtifact(employerId: string, input: Record<string, unknown>): Promise<BuiltMutation> {
  const jobId = num(input.job_id);
  if (jobId === null) throw new Error("job_id is required.");
  const job = await getJob(employerId, jobId);
  if (!job) throw new Error("That job posting could not be found.");
  const pairs = extractQaPairs(input.qa_pairs);
  if (!pairs.length) throw new Error("qa_pairs is required — at least one {question, answer} pair.");

  const payload = { jobId, pairs };
  const artifact: PendingActionArtifact = {
    title: `Add ${pairs.length} FAQ ${pairs.length === 1 ? "entry" : "entries"} for "${job.title}"`,
    irreversible: false,
    resolvedSpecifics: [
      { label: "Job", value: job.title },
      { label: "Entries", value: String(pairs.length) },
    ],
    items: pairs.map((p, i) => ({ id: String(i), label: p.question, artifact: `Q: ${p.question}\nA: ${p.answer}` })),
  };
  return { payload, artifact };
}

async function executeAddJobFaq(employerId: string, actorUserId: string, actorEmail: string | null, payload: Record<string, unknown>): Promise<ExecutionResult> {
  const p = payload as { jobId: number; pairs: JobFaqPair[] };
  const job = await getJob(employerId, p.jobId);
  if (!job) return { ok: false, reason: "That job posting no longer exists." };
  const row = await upsertJobFaqContent({ employerId, jobId: p.jobId, pairs: p.pairs, actorUserId, actorEmail });
  if (!row) return { ok: false, reason: "Could not save this FAQ. Please try again from the portal." };
  return { ok: true, targetType: "job", targetId: p.jobId };
}

// ── enable_candidate_qa (Prompt 6, Section 1 — SAMPLE-FIRST gate) ──────────
// Enabling Q&A for a job is its own, separate approval from add_job_faq: the
// artifact shows the assistant answering THREE realistic candidate questions
// strictly from the job's own grounding (lib/job-faq.ts `generateQaSamples`,
// the exact same grounding + system prompt the real inbound answer path
// uses) — the employer approves the STYLE and grounding, not just a toggle.
// Disabling (disableCandidateQa, below) is instant and needs no approval,
// same reasoning as lib/assistant-mutations.ts `disableSetAckTemplate`:
// removing a future automated send is strictly safer than adding one.
//
// Enablement itself is gated on `isJobPublished` (same check the live
// inbound path uses) — a draft or closed job is refused outright, before
// spending a model call on samples, so the sample card can never promise a
// grounded answer the live path would then refuse to give (the Oct 24 job
// 21 finding: Q&A was enabled on a draft and its samples cited job fields
// the live path was grounding on empty fields for).
export interface EnableQaFailure {
  reason: "no_api_key" | "upstream_error" | "unparseable_output" | "insufficient_output" | "not_published";
}
export async function buildEnableCandidateQaArtifact(employerId: string, input: Record<string, unknown>): Promise<{ result: BuiltMutation | null; failure: EnableQaFailure | null }> {
  const jobId = num(input.job_id);
  if (jobId === null) throw new Error("job_id is required.");
  const job = await getJob(employerId, jobId);
  if (!job) throw new Error("That job posting could not be found.");
  if (!isJobPublished(job)) return { result: null, failure: { reason: "not_published" } };
  const faqRow = await getJobFaq(employerId, jobId);
  const faq = faqRow?.faq || [];
  const { grounding } = buildQAGrounding(job, faq);

  const generated: QaSamplesOutcome = await generateQaSamples(grounding, faq, { employerId, jobId });
  if (!generated.ok) {
    const reason = generated.reason === "not_configured" ? "no_api_key" : generated.reason;
    return { result: null, failure: { reason } };
  }

  const payload = { jobId };
  const artifact: PendingActionArtifact = {
    title: `Turn on Candidate Q&A for "${job.title}"?`,
    irreversible: true,
    irreversibleLabel: "Once approved, the assistant answers matching candidate emails automatically, strictly from the job post and your approved FAQ — no further approval per answer. Anything it can't answer from that still comes to you instead.",
    resolvedSpecifics: [
      { label: "Job", value: job.title },
      { label: "Sample questions", value: String(generated.samples.length) },
    ],
    items: generated.samples.map((s, i) => ({
      id: String(i),
      label: s.question,
      artifact: s.covered ? `Q: ${s.question}\nA: ${s.answer}` : `Q: ${s.question}\nA: (not covered by the job post or FAQ — would notify you instead of guessing)`,
    })),
  };
  return { result: { payload, artifact }, failure: null };
}

async function executeEnableCandidateQa(employerId: string, actorUserId: string, actorEmail: string | null, payload: Record<string, unknown>): Promise<ExecutionResult> {
  const p = payload as { jobId: number };
  const job = await getJob(employerId, p.jobId);
  if (!job) return { ok: false, reason: "That job posting no longer exists." };
  // Re-checked at approval time, not just when the card was built: the job
  // could have been closed/unpublished in between (an employer approving a
  // stale pending action). The sample card is not grounds to turn it on.
  if (!isJobPublished(job)) return { ok: false, reason: "This job isn't published anymore — Candidate Q&A can't be turned on. Publish it again and re-approve." };
  const row = await setJobFaqEnabled({ employerId, jobId: p.jobId, enabled: true, actorUserId, actorEmail });
  if (!row) return { ok: false, reason: "Could not turn on Candidate Q&A. Please try again from the portal." };
  return { ok: true, targetType: "job", targetId: p.jobId };
}

export interface DisableCandidateQaResult {
  jobId: number;
  disabled: boolean;
  message: string;
}

export async function disableCandidateQa(employerId: string, actorUserId: string, actorEmail: string | null, input: Record<string, unknown>): Promise<DisableCandidateQaResult> {
  const jobId = num(input.job_id);
  if (jobId === null) throw new Error("job_id is required.");
  const job = await getJob(employerId, jobId);
  if (!job) throw new Error("That job posting could not be found.");
  const existing = await getJobFaq(employerId, jobId);
  if (!existing?.enabled) {
    return { jobId, disabled: false, message: `Candidate Q&A isn't on for "${job.title}" — nothing to turn off.` };
  }
  const row = await setJobFaqEnabled({ employerId, jobId, enabled: false, actorUserId, actorEmail });
  if (!row) throw new Error("Could not turn off Candidate Q&A. Please try again from the portal.");
  return { jobId, disabled: true, message: `Turned off Candidate Q&A for "${job.title}".` };
}

// ── onboarding_plan (Prompt 6, Section 3 — onboarding chase) ───────────────
// Never offered to the model as a tool — the pending action is created
// directly by lib/onboarding-chase.ts's 30-minute scan the moment an offer
// envelope transitions to 'completed', same reasoning as
// reschedule_interview's email-reply path: this is a system-detected event,
// not something an employer asks for in chat. Building that artifact lives
// in lib/onboarding-chase.ts itself (duplicated inline there), NOT here —
// see that file's header for why: it must stay importable by the
// edge-compiled graph instrumentation.ts goes through, and this file
// (lib/assistant-mutations.ts) is explicitly one of the imports that breaks
// that compile. Execution (below) only ever runs from the approve API
// route, never from instrumentation.ts, so it's free to reach
// lib/employees-store.ts / lib/onboarding-store.ts with no such constraint.
async function executeOnboardingPlan(employerId: string, pendingActionId: string, actorUserId: string, actorEmail: string | null, payload: Record<string, unknown>): Promise<ExecutionResult> {
  const p = payload as { applicantId: number; jobId: number; plan: OnboardingPlanContent; createEmployeeRecord: boolean };
  const applicant = await getApplicant(employerId, p.applicantId);
  if (!applicant) return { ok: false, reason: "That candidate no longer exists." };

  const saved = await saveOnboardingPlan({ employerId, applicantId: p.applicantId, jobId: p.jobId, plan: p.plan, pendingActionId, actorUserId, actorEmail });
  if (!saved) return { ok: false, reason: "Could not save this onboarding plan. Please try again from the portal." };

  // Re-checked at approval time (not just when drafted): skip the handoff if
  // an employee with this email now exists, even if it didn't when the card
  // was first drafted.
  if (p.createEmployeeRecord && applicant.email) {
    const existing = await listEmployees(employerId);
    const already = existing.some((e) => (e.email || "").trim().toLowerCase() === applicant.email.trim().toLowerCase());
    if (!already) {
      await createEmployee(employerId, { name: applicant.name, email: applicant.email, startDate: p.plan.startDateIso });
    }
  }

  // Each reminder's `sendAt` is whatever the plan computed (days before/after
  // the real start date) — unlike message_candidates' fixed undo window,
  // these are routinely DAYS in the future; the existing 15-second
  // assistant_send_queue scan (lib/assistant-send-worker.ts) already just
  // checks `send_at <= now`, so no new send infrastructure is needed here.
  for (const reminder of p.plan.reminders) {
    await enqueueSend({ pendingActionId, employerId, candidateId: p.applicantId, body: reminder.body, sendAt: reminder.sendAt });
  }
  return { ok: true, targetType: "candidate", targetId: p.applicantId };
}

// ── send_offer (Prompt 4 — offer letters via DocuSign) ──────────────────────
// Execution reuses lib/docusign-offer-send.ts `sendOfferEnvelope` — the EXACT
// same function the hand-driven DocuSign send form calls for a plain offer
// letter (app/api/employer/docusign/send/route.ts) — so there is no second
// implementation of envelope-building, the send cap, or the DocuSign API call.
export async function buildSendOfferArtifact(employerId: string, input: Record<string, unknown>): Promise<BuiltMutation> {
  const applicantId = num(input.candidate_id);
  if (applicantId === null) throw new Error("candidate_id is required.");
  const applicant = await getApplicant(employerId, applicantId);
  if (!applicant) throw new Error("That candidate could not be found.");
  const position = str(input.position).trim();
  if (!position) throw new Error("position is required.");
  const salary = str(input.salary).trim();
  const startDate = str(input.start_date).trim();
  const extraTerms = str(input.extra_terms).trim();
  const message = str(input.message).trim();
  const subject = str(input.subject).trim();

  const payload = { applicantId, position, salary, startDate, extraTerms, message, subject };
  const artifact: PendingActionArtifact = {
    title: `Send an offer letter to ${applicant.name}`,
    irreversible: true,
    irreversibleLabel: "This sends a real DocuSign envelope for signature once approved — it can't be unsent.",
    resolvedSpecifics: [
      { label: "Recipient", value: `${applicant.name} <${applicant.email}>` },
      { label: "Document", value: "Offer letter" },
      { label: "Position", value: position },
      ...(salary ? [{ label: "Salary", value: salary }] : []),
      ...(startDate ? [{ label: "Start date", value: startDate }] : []),
    ],
    items: [
      {
        id: String(applicantId),
        label: applicant.name,
        artifact: [
          `To: ${applicant.name} <${applicant.email}>`,
          `Document: Offer letter`,
          `Position: ${position}`,
          salary ? `Salary: ${salary}` : "",
          startDate ? `Start date: ${startDate}` : "",
          extraTerms ? `Additional terms: ${extraTerms}` : "",
          message ? `\nPersonal message: ${message}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  };
  return { payload, artifact };
}

async function executeSendOffer(employerId: string, actorUserId: string, access: Access | null, payload: Record<string, unknown>): Promise<ExecutionResult> {
  const p = payload as { applicantId: number; position: string; salary: string; startDate: string; extraTerms: string; message: string; subject: string };
  if (!access) return { ok: false, reason: "Could not resolve this employer's plan. Please try again from the portal." };
  const result = await sendOfferEnvelope(employerId, actorUserId, access, {
    applicantId: p.applicantId,
    position: p.position,
    salary: p.salary,
    startDate: p.startDate,
    extraTerms: p.extraTerms,
    message: p.message,
    subject: p.subject,
  });
  if (!result.ok) return { ok: false, reason: result.message };
  return { ok: true, targetType: "candidate", targetId: p.applicantId, payloadPatch: { envelopeId: result.envelopeId, envelopeStatus: result.status } };
}

// ── reschedule_interview (Prompt 3 — a candidate's plain-email reply) ───────
// Unlike the four tools above, this action is never offered to the model: it
// is created directly by lib/assistant-inbound.ts when a candidate's email
// reply parses as a reschedule request. It still goes through the exact same
// pending-action → confirmation-card → approve pipeline as everything else
// (it appears in the employer's inbox "like any other action" — the spec for
// this feature), which is why it lives here rather than in a separate module.
export interface RescheduleInterviewInput {
  interviewId: number;
  employerId: string;
  candidateName: string;
  currentScheduledAt: string;
  proposedTimes: string[];
  quotedText: string;
}

export async function buildRescheduleInterviewArtifact(input: RescheduleInterviewInput): Promise<BuiltMutation> {
  const employerTz = await getEmployerTimezone(input.employerId);
  const proposed = input.proposedTimes[0] || "";
  const payload = { interviewId: input.interviewId, expectedScheduledAt: input.currentScheduledAt, newScheduledAt: proposed };
  const artifact: PendingActionArtifact = {
    title: `Reschedule interview with ${input.candidateName}?`,
    irreversible: false,
    resolvedSpecifics: [
      { label: "Candidate", value: input.candidateName },
      { label: "Current time", value: formatEmployerTime(input.currentScheduledAt, employerTz) },
      {
        label: "Proposed",
        value: input.proposedTimes.length ? input.proposedTimes.map((t) => formatEmployerTime(t, employerTz)).join(", ") : "(could not parse an exact time)",
      },
    ],
    items: [
      {
        id: String(input.interviewId),
        label: input.candidateName,
        artifact: `Candidate replied: "${input.quotedText}"\n\nProposed new time: ${proposed ? formatEmployerTime(proposed, employerTz) : "(unparsed)"}`,
      },
    ],
  };
  return { payload, artifact };
}

// ── reschedule_interview (Fix Round 3, Section A — employer-initiated, via chat) ──
// The email-reply path above always knows the exact interviewId (it comes
// from the reply-token, never a name match). An employer typing "reschedule
// the interview with Maria to Friday at 2pm" in chat has no token — the
// candidate is named in plain text, and that name must resolve against a
// REAL scheduled interview before any card is drafted. Resolution happens
// entirely against `listInterviews(..., { status: "scheduled" })`: a name
// with zero or more than one match returns a structured, non-throwing
// `RescheduleResolution` (candidate options the model can read back to the
// employer as a clarifying question, e.g. "did you mean A or B?") rather
// than a dead-end error — the Oct 23 report was exactly a dead end
// ("could not find a candidate named ..."), not merely an unhelpful one.
export interface RescheduleCandidateOption {
  candidateId: number;
  name: string;
  jobTitle: string;
  interviewId: number;
  scheduledAt: string;
}

export interface RescheduleResolution {
  status: "resolved" | "no_match" | "ambiguous";
  interviewId?: number;
  candidateName?: string;
  currentScheduledAt?: string;
  /** Present for every status: the full list of candidates who currently
   *  have a scheduled interview (narrowed to the matches for "ambiguous") —
   *  what a candidate-picker in the UI would offer as chips. */
  candidates: RescheduleCandidateOption[];
}

function toRescheduleOption(iv: { id: number; applicantId: number; applicantName?: string; jobTitle?: string; scheduledAt: string }): RescheduleCandidateOption {
  return { candidateId: iv.applicantId, name: iv.applicantName || "Unknown candidate", jobTitle: iv.jobTitle || "", interviewId: iv.id, scheduledAt: iv.scheduledAt };
}

/** Resolve "which scheduled interview does the employer mean" by candidate
 *  id (exact) or candidate name (case-insensitive, then a substring fallback
 *  for a partial/misremembered name) — optionally narrowed to one job. Never
 *  throws: every outcome, including no match at all, is a normal return so
 *  the caller can offer the candidate list as options instead of a dead end. */
export async function resolveRescheduleCandidate(
  employerId: string,
  input: { candidateId?: number | null; candidateName?: string; jobId?: number | null }
): Promise<RescheduleResolution> {
  const scheduled = await listInterviews(employerId, { status: "scheduled" });
  const pool = input.jobId != null ? scheduled.filter((iv) => iv.jobId === input.jobId) : scheduled;
  const options = pool.map(toRescheduleOption);

  if (input.candidateId != null) {
    const match = pool.find((iv) => iv.applicantId === input.candidateId);
    if (!match) return { status: "no_match", candidates: options };
    return { status: "resolved", interviewId: match.id, candidateName: match.applicantName || "the candidate", currentScheduledAt: match.scheduledAt, candidates: options };
  }

  const name = (input.candidateName || "").trim().toLowerCase();
  if (!name) return { status: "no_match", candidates: options };

  const exact = pool.filter((iv) => (iv.applicantName || "").trim().toLowerCase() === name);
  const matches = exact.length ? exact : pool.filter((iv) => (iv.applicantName || "").trim().toLowerCase().includes(name));

  if (!matches.length) return { status: "no_match", candidates: options };
  if (matches.length > 1) return { status: "ambiguous", candidates: matches.map(toRescheduleOption) };

  const only = matches[0];
  return { status: "resolved", interviewId: only.id, candidateName: only.applicantName || "the candidate", currentScheduledAt: only.scheduledAt, candidates: options };
}

export interface ChatRescheduleInput {
  employerId: string;
  interviewId: number;
  candidateName: string;
  currentScheduledAt: string;
  newScheduledAt: string;
}

/** Builds the exact same `{ interviewId, expectedScheduledAt, newScheduledAt }`
 *  payload shape the email-reply path builds — `executeRescheduleInterview`
 *  is shared end to end, so an employer-initiated reschedule is moved, never
 *  inserted, by construction (it is literally the same execution code). */
export async function buildChatRescheduleArtifact(input: ChatRescheduleInput): Promise<BuiltMutation> {
  const employerTz = await getEmployerTimezone(input.employerId);
  const payload = { interviewId: input.interviewId, expectedScheduledAt: input.currentScheduledAt, newScheduledAt: input.newScheduledAt };
  const artifact: PendingActionArtifact = {
    title: `Reschedule interview with ${input.candidateName}?`,
    irreversible: false,
    resolvedSpecifics: [
      { label: "Candidate", value: input.candidateName },
      { label: "Current time", value: formatEmployerTime(input.currentScheduledAt, employerTz) },
      { label: "New time", value: formatEmployerTime(input.newScheduledAt, employerTz) },
    ],
    items: [
      {
        id: String(input.interviewId),
        label: input.candidateName,
        artifact: `${input.candidateName}: ${formatEmployerTime(input.currentScheduledAt, employerTz)} → ${formatEmployerTime(input.newScheduledAt, employerTz)}`,
      },
    ],
  };
  return { payload, artifact };
}

// ── create_interview_kit (Prompt 5) ─────────────────────────────────────────
// The LLM call itself (grounded ONLY in the job's own fields, anti-fabrication
// rule) lives in lib/interview-kits.ts `generateInterviewKit` — this function
// only turns an already-generated kit into the confirmation card; the
// thin-job-post refusal path runs before this is ever called
// (lib/assistant-tools.ts `createInterviewKit`, via `jobHasEnoughSubstance`).
export async function buildCreateInterviewKitArtifact(jobId: number, jobTitle: string, kit: InterviewKitContent): Promise<BuiltMutation> {
  const payload = { jobId, questions: kit.questions, scorecard: kit.scorecard };
  const artifact: PendingActionArtifact = {
    title: `Create an interview kit for "${jobTitle}"`,
    irreversible: false,
    resolvedSpecifics: [
      { label: "Job", value: jobTitle },
      { label: "Questions", value: String(kit.questions.length) },
      { label: "Scorecard criteria", value: String(kit.scorecard.length) },
    ],
    items: [
      {
        id: String(jobId),
        artifact: ["Interview questions:", ...kit.questions.map((q, i) => `${i + 1}. ${q}`), "", "Scorecard:", ...kit.scorecard.map((c) => `• ${c}`)].join("\n"),
      },
    ],
  };
  return { payload, artifact };
}

async function executeCreateInterviewKit(employerId: string, payload: Record<string, unknown>): Promise<ExecutionResult> {
  const p = payload as { jobId: number; questions: string[]; scorecard: string[] };
  const job = await getJob(employerId, p.jobId);
  if (!job) return { ok: false, reason: "That job posting no longer exists." };
  const ok = await saveInterviewKit(employerId, p.jobId, { questions: p.questions, scorecard: p.scorecard }, "llm");
  if (!ok) return { ok: false, reason: "Could not save this interview kit. Please try again from the portal." };
  return { ok: true, targetType: "job", targetId: p.jobId };
}

// ── summarize_interview (Prompt 6, Section 2 — video-interview summarization) ──
// The LLM call + anti-fabrication guard live in lib/interview-summaries.ts
// `generateInterviewSummary` — this function only turns an already-generated
// summary into the confirmation card. The no-kit refusal runs BEFORE any
// model call, same shape as create_interview_kit's thin-job refusal
// (lib/assistant-tools.ts `summarizeInterview`).
export async function buildSummarizeInterviewArtifact(
  interviewId: number,
  jobTitle: string,
  candidateName: string,
  summary: { criteria: { criterion: string; assessment: string; quote: string }[] }
): Promise<BuiltMutation> {
  const payload = { interviewId, summary };
  const artifact: PendingActionArtifact = {
    title: `Interview summary for ${candidateName} — ${jobTitle}`,
    irreversible: false,
    resolvedSpecifics: [
      { label: "Candidate", value: candidateName },
      { label: "Job", value: jobTitle },
      { label: "Criteria scored", value: String(summary.criteria.length) },
      { label: "Advisory", value: "This is an aid, not a hiring decision — you still score and decide." },
    ],
    items: [
      {
        id: String(interviewId),
        artifact: summary.criteria
          .map((c) => `${c.criterion}: ${c.assessment}${c.quote ? `\n  — "${c.quote}"` : ""}`)
          .join("\n\n"),
      },
    ],
  };
  return { payload, artifact };
}

async function executeSummarizeInterview(employerId: string, payload: Record<string, unknown>): Promise<ExecutionResult> {
  const p = payload as { interviewId: number; summary: { criteria: { criterion: string; assessment: string; quote: string }[] } };
  const interview = await getInterview(employerId, p.interviewId);
  if (!interview) return { ok: false, reason: "That interview no longer exists." };
  const ok = await saveInterviewSummary(employerId, p.interviewId, p.summary);
  if (!ok) return { ok: false, reason: "Could not save this interview summary. Please try again from the portal." };
  return { ok: true, targetType: "interview", targetId: p.interviewId };
}

// Fix Round 3, Section A: this executor MOVES an existing interview via
// `updateInterview` — it must never INSERT a new one (the Oct 23 defect:
// approval created a SECOND interview at the new time, left the original
// untouched, and sent a fresh "scheduled" confirmation rather than a
// "rescheduled" one). `createInterview` is deliberately never imported into
// this function; scripts/test-employer-assistant.cjs scans this function's
// own source for a `createInterview(` call and fails the build if one ever
// creeps back in, the same way the audit log's append-only guarantee is
// proven by a source scan rather than trusted by convention alone.
async function executeRescheduleInterview(employerId: string, payload: Record<string, unknown>): Promise<ExecutionResult> {
  const p = payload as { interviewId: number; expectedScheduledAt: string; newScheduledAt: string };
  const interview = await getInterviewForToken(p.interviewId);
  if (!interview || interview.employerId !== employerId) return { ok: false, reason: "That interview no longer exists." };
  // Re-verify at EXECUTION time, not just when the reply was first read — a
  // cancellation in between must fail the reschedule with a reason rather
  // than silently reviving a cancelled interview (hard requirement).
  if (interview.status !== "scheduled") {
    return { ok: false, reason: `This interview is no longer scheduled (status: "${interview.status}") — nothing was changed. The candidate was not notified.` };
  }
  if (!p.newScheduledAt || !Number.isFinite(new Date(p.newScheduledAt).getTime())) {
    return { ok: false, reason: "No valid new time was parsed from the candidate's reply — reschedule manually from the portal." };
  }
  const ok = await updateInterview(employerId, p.interviewId, { scheduledAt: new Date(p.newScheduledAt).toISOString() });
  if (!ok) return { ok: false, reason: "Could not update the interview. Please try again from the portal." };
  const updated = await getInterview(employerId, p.interviewId);
  if (updated) {
    notifyCandidateOfInterview(employerId, updated, "rescheduled").catch(() => {});
    const employerTz = await getEmployerTimezone(employerId);
    logActivityForEmployer(employerId, {
      eventType: "assistant_reschedule_approved",
      title: `${updated.applicantName || "A candidate"} was rescheduled to ${formatEmployerTime(updated.scheduledAt, employerTz)}`,
      body: "The assistant approved a time the candidate proposed by email.",
      link: "/employer/collab?tab=interviews",
    }).catch(() => {});
  }
  return { ok: true, targetType: "interview", targetId: p.interviewId };
}

// ── execution dispatcher ─────────────────────────────────────────────────────
export type ExecutionResult =
  | { ok: true; targetType: string | null; targetId: string | number | null; payloadPatch?: Record<string, unknown> }
  | { ok: false; reason: string };

/** Run the real mutation behind an already-claimed pending action
 *  (`row.status` is already 'executed' — see `claimForExecution`). Every
 *  branch reuses the same lib function the hand-driven employer UI calls;
 *  there is no second implementation of job/pipeline/schedule/message logic
 *  here. */
export async function executePendingAction(
  row: PendingActionRow,
  approvingUserId: string,
  approvingUserEmail: string | null = null,
  approvingAccess: Access | null = null
): Promise<ExecutionResult> {
  try {
    switch (row.action) {
      case "draft_job_post":
        return await executeDraftJobPost(row.employerId, row.payload, approvingAccess);
      case "publish_job":
        return await executePublishJob(row.employerId, row.payload, approvingAccess);
      case "distribute_job":
        return await executeDistributeJob(row.employerId, approvingUserId, approvingUserEmail, row.payload);
      case "move_candidates":
        return await executeMoveCandidates(row.employerId, row.payload);
      case "schedule_interviews":
        return await executeScheduleInterviews(row.employerId, approvingUserId, row.payload);
      case "message_candidates":
        return await executeMessageCandidates(row.employerId, row.id, row.payload);
      case "reschedule_interview":
        return await executeRescheduleInterview(row.employerId, row.payload);
      case "set_ack_template":
        return await executeSetAckTemplate(row.employerId, approvingUserId, approvingUserEmail, row.payload);
      case "send_offer":
        return await executeSendOffer(row.employerId, approvingUserId, approvingAccess, row.payload);
      case "create_interview_kit":
        return await executeCreateInterviewKit(row.employerId, row.payload);
      case "summarize_interview":
        return await executeSummarizeInterview(row.employerId, row.payload);
      case "add_job_faq":
        return await executeAddJobFaq(row.employerId, approvingUserId, approvingUserEmail, row.payload);
      case "enable_candidate_qa":
        return await executeEnableCandidateQa(row.employerId, approvingUserId, approvingUserEmail, row.payload);
      case "onboarding_plan":
        return await executeOnboardingPlan(row.employerId, row.id, approvingUserId, approvingUserEmail, row.payload);
      default:
        return { ok: false, reason: `Unknown action "${row.action}".` };
    }
  } catch (e) {
    console.error("[assistant-mutations] executePendingAction threw", { id: row.id, action: row.action, error: e });
    return { ok: false, reason: e instanceof Error ? e.message : "Unexpected error while executing this action." };
  }
}

export interface ApproveOutcome {
  found: boolean;
  forbidden: boolean;
  status: PendingActionStatus;
  failureReason?: string | null;
  targetType?: string | null;
  targetId?: string | number | null;
}

/** Approve one pending action: employer-scoped (403 on mismatch, distinct
 *  from 404 not-found), idempotent (a non-'pending' row no-ops and reports
 *  its current status instead of re-executing), and the only path that ever
 *  runs the real mutation. Shared by the single-approve route and the
 *  batch-approve route so there is exactly one approval code path. */
export async function approvePendingAction(employerId: string, actorUserId: string, actorEmail: string | null, id: string, access: Access | null = null): Promise<ApproveOutcome> {
  const existing = await getPendingActionById(id);
  if (!existing) return { found: false, forbidden: false, status: "cancelled" };
  if (existing.employerId !== employerId) return { found: true, forbidden: true, status: existing.status };

  if (existing.status === "pending" && isPendingExpired(existing)) {
    const cancelled = await markCancelled(employerId, id, "This request expired 24 hours after it was drafted and was never approved.");
    return { found: true, forbidden: false, status: cancelled ? "cancelled" : existing.status, failureReason: cancelled?.failureReason ?? null };
  }

  if (existing.status !== "pending") {
    return { found: true, forbidden: false, status: existing.status, failureReason: existing.failureReason };
  }

  const claimed = await claimForExecution(employerId, id);
  if (!claimed) {
    const current = await getPendingActionById(id);
    return { found: true, forbidden: false, status: current?.status || "executed", failureReason: current?.failureReason ?? null };
  }

  const result = await executePendingAction(claimed, actorUserId, actorEmail, access);
  if (result.ok) {
    if (result.payloadPatch) await patchPendingActionPayload(id, result.payloadPatch);
    await logAction({
      employerId,
      actorUserId,
      actorEmail,
      action: claimed.action,
      targetType: result.targetType,
      targetId: result.targetId,
      payload: claimed.payload,
      status: "executed",
    });
    // Taylor Combined Build v5, Section D: deterministic, observation-only
    // learning runs ONLY on an action that actually, really executed — never
    // on a draft, and never on something cancelled or failed — so a learned
    // "habit" can only ever reflect what this employer truly approved.
    // Best-effort by construction (lib/assistant-employer-learning.ts never
    // throws); never allowed to affect the approval outcome itself.
    await observeApprovedAction(employerId, claimed.action, claimed.payload);
    return { found: true, forbidden: false, status: "executed", targetType: result.targetType, targetId: result.targetId };
  }

  await markPendingFailed(employerId, id, result.reason);
  await logAction({
    employerId,
    actorUserId,
    actorEmail,
    action: claimed.action,
    targetType: null,
    targetId: null,
    payload: claimed.payload,
    status: "failed",
  });
  return { found: true, forbidden: false, status: "failed", failureReason: result.reason };
}

export interface CancelOutcome {
  found: boolean;
  forbidden: boolean;
  status: PendingActionStatus;
}

/** Cancel one pending action. Same employer-scoping and idempotency shape as
 *  `approvePendingAction`; a non-'pending' row simply reports its current
 *  status rather than erroring. */
export async function cancelPendingAction(employerId: string, id: string): Promise<CancelOutcome> {
  const existing = await getPendingActionById(id);
  if (!existing) return { found: false, forbidden: false, status: "cancelled" };
  if (existing.employerId !== employerId) return { found: true, forbidden: true, status: existing.status };
  if (existing.status !== "pending") return { found: true, forbidden: false, status: existing.status };
  const cancelled = await markCancelled(employerId, id);
  return { found: true, forbidden: false, status: cancelled ? "cancelled" : existing.status };
}
