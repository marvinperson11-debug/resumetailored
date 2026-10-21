import { getJob, listApplicants, getApplicant, createJob, updateApplicant } from "./employer-store";
import { listInterviews, createInterview, getInterview, getInterviewForToken, updateInterview } from "./employer-collab-store";
import { notifyCandidateOfInterview, notifyInterviewerOfInterview } from "./employer-notify";
import { APPLICANT_STATUSES, isApplicantStatus, isInterviewMode, type ApplicantStatus, type Applicant } from "./employer-ai";
import {
  getPendingActionById,
  claimForExecution,
  markFailed as markPendingFailed,
  markCancelled,
  isPendingExpired,
  type PendingActionArtifact,
  type PendingActionRow,
  type PendingActionStatus,
} from "./assistant-pending";
import { enqueueSend } from "./assistant-send-queue";
import { logAction } from "./assistant-audit";
import { logActivityForEmployer } from "./notifications-store";

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
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`;
}
function personalize(body: string, a: Pick<Applicant, "name">): string {
  const firstName = (a.name || "there").split(" ")[0] || "there";
  return body.replace(/\{\{\s*firstName\s*\}\}/gi, firstName).replace(/\{\{\s*name\s*\}\}/gi, a.name || "there");
}

interface BuiltMutation {
  payload: Record<string, unknown>;
  artifact: PendingActionArtifact;
}

// ── draft_job_post ───────────────────────────────────────────────────────────
export async function buildDraftJobPostArtifact(input: Record<string, unknown>): Promise<BuiltMutation> {
  const roleDescription = str(input.role_description).trim();
  if (roleDescription.length < 10) throw new Error("role_description must be the full job post text you've composed (at least 10 characters).");
  const title = (str(input.title).trim() || firstLine(roleDescription) || "Untitled role").slice(0, 200);
  const location = str(input.location).trim();
  const payRange = str(input.pay_range).trim();
  const hours = str(input.hours).trim();
  const publish = input.publish === true;

  const extras: string[] = [];
  if (payRange) extras.push(`Pay range: ${payRange}`);
  if (hours) extras.push(`Hours: ${hours}`);
  const description = extras.length ? `${roleDescription}\n\n${extras.join("\n")}` : roleDescription;

  const payload = { title, description, location, publish };
  const artifact: PendingActionArtifact = {
    title: publish ? "Post a new job — will be published" : "Draft a new job posting",
    irreversible: false,
    resolvedSpecifics: [
      { label: "Title", value: title },
      ...(location ? [{ label: "Location", value: location }] : []),
      { label: "Visibility", value: publish ? "Published — live on the public job board" : "Draft — not published" },
    ],
    items: [{ id: "job", artifact: `${title}${location ? ` — ${location}` : ""}\n\n${description}` }],
  };
  return { payload, artifact };
}

async function executeDraftJobPost(employerId: string, payload: Record<string, unknown>): Promise<ExecutionResult> {
  const p = payload as { title: string; description: string; location: string; publish: boolean };
  const job = await createJob(employerId, {
    title: p.title,
    description: p.description,
    location: p.location,
    status: p.publish ? "active" : "draft",
    publicListed: !!p.publish,
  });
  if (!job) return { ok: false, reason: "Could not create the job posting. Please try again from the portal." };
  return { ok: true, targetType: "job", targetId: job.id };
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
      { label: "When", value: formatWhen(scheduledAt) },
      { label: "Duration", value: `${durationMin} min` },
      { label: "Mode", value: mode },
    ],
    items: resolved.map((r) => ({
      id: String(r.id),
      label: r.name,
      artifact: `${r.name} — ${mode} interview, ${formatWhen(scheduledAt)} (${durationMin} min)${r.clash ? `\n⚠ ${r.clash}` : ""}`,
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
export async function buildMessageCandidatesArtifact(employerId: string, input: Record<string, unknown>): Promise<BuiltMutation> {
  const message = str(input.message).trim();
  if (message.length < 2) throw new Error("message is required — write the full message body.");

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

  const payload = { candidates: targets.map((a) => ({ id: a.id })), message };
  const artifact: PendingActionArtifact = {
    title: targets.length === 1 ? `Send a message to ${targets[0].name}` : `Send a message to ${targets.length} candidates`,
    irreversible: true,
    irreversibleLabel: "This can't be unsent once it sends — you'll have a short window to undo right after approving.",
    resolvedSpecifics: [{ label: "Recipients", value: targets.map((a) => a.name).join(", ") }],
    items: targets.map((a) => ({ id: String(a.id), label: a.name, artifact: personalize(message, a) })),
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

export function buildRescheduleInterviewArtifact(input: RescheduleInterviewInput): BuiltMutation {
  const proposed = input.proposedTimes[0] || "";
  const payload = { interviewId: input.interviewId, expectedScheduledAt: input.currentScheduledAt, newScheduledAt: proposed };
  const artifact: PendingActionArtifact = {
    title: `Reschedule interview with ${input.candidateName}?`,
    irreversible: false,
    resolvedSpecifics: [
      { label: "Candidate", value: input.candidateName },
      { label: "Current time", value: formatWhen(input.currentScheduledAt) },
      { label: "Proposed", value: input.proposedTimes.length ? input.proposedTimes.map(formatWhen).join(", ") : "(could not parse an exact time)" },
    ],
    items: [
      {
        id: String(input.interviewId),
        label: input.candidateName,
        artifact: `Candidate replied: "${input.quotedText}"\n\nProposed new time: ${proposed ? formatWhen(proposed) : "(unparsed)"}`,
      },
    ],
  };
  return { payload, artifact };
}

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
    logActivityForEmployer(employerId, {
      eventType: "assistant_reschedule_approved",
      title: `${updated.applicantName || "A candidate"} was rescheduled to ${formatWhen(updated.scheduledAt)}`,
      body: "The assistant approved a time the candidate proposed by email.",
      link: "/employer/collab?tab=interviews",
    }).catch(() => {});
  }
  return { ok: true, targetType: "interview", targetId: p.interviewId };
}

// ── execution dispatcher ─────────────────────────────────────────────────────
export type ExecutionResult = { ok: true; targetType: string | null; targetId: string | number | null } | { ok: false; reason: string };

/** Run the real mutation behind an already-claimed pending action
 *  (`row.status` is already 'executed' — see `claimForExecution`). Every
 *  branch reuses the same lib function the hand-driven employer UI calls;
 *  there is no second implementation of job/pipeline/schedule/message logic
 *  here. */
export async function executePendingAction(row: PendingActionRow, approvingUserId: string): Promise<ExecutionResult> {
  try {
    switch (row.action) {
      case "draft_job_post":
        return await executeDraftJobPost(row.employerId, row.payload);
      case "move_candidates":
        return await executeMoveCandidates(row.employerId, row.payload);
      case "schedule_interviews":
        return await executeScheduleInterviews(row.employerId, approvingUserId, row.payload);
      case "message_candidates":
        return await executeMessageCandidates(row.employerId, row.id, row.payload);
      case "reschedule_interview":
        return await executeRescheduleInterview(row.employerId, row.payload);
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
export async function approvePendingAction(employerId: string, actorUserId: string, actorEmail: string | null, id: string): Promise<ApproveOutcome> {
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

  const result = await executePendingAction(claimed, actorUserId);
  if (result.ok) {
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
