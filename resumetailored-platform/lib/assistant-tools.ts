import { listJobs, getJob, listApplicants, getApplicant } from "./employer-store";
import { listInterviews } from "./employer-collab-store";
import type { Applicant, ApplicantStatus, JobPosting } from "./employer-ai";
import {
  createPendingAction,
  getPendingActionById,
  updatePendingActionArtifact,
  resolvePendingUpsertTarget,
  resolveDraftUpsertTarget,
  listPendingActions,
  type PendingActionRow,
  type DraftUpsertCandidate,
} from "./assistant-pending";
import {
  buildDraftJobPostArtifact,
  buildPublishJobArtifact,
  buildMoveCandidatesArtifact,
  buildScheduleInterviewsArtifact,
  buildMessageCandidatesArtifact,
  buildSetAckTemplateArtifact,
  buildSendOfferArtifact,
  buildChatRescheduleArtifact,
  buildCreateInterviewKitArtifact,
  resolveRescheduleCandidate,
  disableSetAckTemplate,
  type JobFieldUpdates,
} from "./assistant-mutations";
import { assistantStaleDays, staleSummary, type StaleCandidateLike } from "./assistant-staleness";
import { getPlaybook, PLAYBOOK_KEYS, playbookKeyList } from "./playbooks";
import { jobHasEnoughSubstance, generateInterviewKit } from "./interview-kits";
import { buildHiringReport, type HiringReportPeriod } from "./hiring-report";

/**
 * The Employer Portal AI Assistant's tool registry — READ-ONLY, Phase 0.
 * Every tool calls the SAME lib data-access function the existing employer
 * API routes already use (listJobs/listApplicants/getApplicant from
 * employer-store.ts, listInterviews from employer-collab-store.ts), scoped by
 * the caller's own `employerId` exactly as those routes scope it. There is no
 * parallel data-access path here, and — just as importantly — there is no
 * mutating tool in this file: the registry itself is the enforcement
 * mechanism for "the assistant cannot take actions yet", not just a system
 * prompt instruction. A later prompt that adds mutating tools does so here,
 * behind the confirmation-card pattern (docs/assistant-confirmation-card.md).
 */

export interface AssistantToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolResult {
  /** `targetType`/`targetId` are for the audit log — e.g. ("job", 42) — null
   *  when the call has no single obvious target (e.g. a date-range query). */
  targetType: string | null;
  targetId: string | number | null;
  data: unknown;
}

/** `ctx` is who is having this chat turn, for the mutating tools' pending-action
 *  rows (lib/assistant-pending.ts `createPendingAction` wants an actor to
 *  attribute the draft to) — the five read-only executors below simply
 *  ignore the third argument, which TypeScript allows for a function with
 *  fewer declared parameters than its assigned type. */
export type ToolExecutor = (employerId: string, input: Record<string, unknown>, ctx: { actorUserId: string; actorEmail: string | null }) => Promise<ToolResult>;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The fields safe to hand to the model for a job — never anything beyond
 *  what the employer's own jobs API already returns. */
function jobSummary(j: JobPosting) {
  return {
    id: j.id,
    title: j.title,
    department: j.department,
    location: j.location,
    status: j.status,
    publicListed: !!j.publicListed,
    applicantCount: j.applicantCount ?? 0,
    createdAt: j.createdAt,
  };
}

function applicantSummary(a: Applicant) {
  return {
    id: a.id,
    jobId: a.jobId,
    jobTitle: a.jobTitle || "",
    name: a.name,
    email: a.email,
    status: a.status,
    matchScore: a.matchScore,
    createdAt: a.createdAt,
  };
}

const getJobs: ToolExecutor = async (employerId, input) => {
  const jobs = await listJobs(employerId);
  const jobId = num(input.jobId);
  const status = str(input.status);
  const filtered = jobs.filter((j) => (jobId === null || j.id === jobId) && (!status || j.status === status));
  return { targetType: jobId !== null ? "job" : null, targetId: jobId, data: { jobs: filtered.map(jobSummary) } };
};

const summarizeCandidates: ToolExecutor = async (employerId, input) => {
  const jobId = num(input.jobId);
  if (jobId === null) throw new Error("jobId is required");
  const applicants = await listApplicants(employerId, { jobId });
  return { targetType: "job", targetId: jobId, data: { jobId, count: applicants.length, candidates: applicants.map(applicantSummary) } };
};

const PIPELINE_STATUSES: ApplicantStatus[] = ["new", "reviewed", "shortlisted", "interviewed", "offer extended", "hired", "rejected"];

const summarizePipeline: ToolExecutor = async (employerId, input) => {
  const jobId = num(input.jobId);
  if (jobId === null) throw new Error("jobId is required");
  const applicants = await listApplicants(employerId, { jobId });
  const counts = Object.fromEntries(PIPELINE_STATUSES.map((s) => [s, 0])) as Record<ApplicantStatus, number>;
  for (const a of applicants) counts[a.status] = (counts[a.status] || 0) + 1;
  return { targetType: "job", targetId: jobId, data: { jobId, total: applicants.length, counts } };
};

const getSchedule: ToolExecutor = async (employerId, input) => {
  const start = str(input.start);
  const end = str(input.end);
  const startMs = start ? new Date(start).getTime() : NaN;
  const endMs = end ? new Date(end).getTime() : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new Error("start and end must be valid ISO dates");
  const interviews = await listInterviews(employerId, {});
  const inRange = interviews.filter((iv) => {
    const t = new Date(iv.scheduledAt).getTime();
    return Number.isFinite(t) && t >= startMs && t <= endMs;
  });
  return {
    targetType: null,
    targetId: null,
    data: {
      start,
      end,
      interviews: inRange.map((iv) => ({
        id: iv.id,
        applicantId: iv.applicantId,
        applicantName: iv.applicantName || "",
        jobTitle: iv.jobTitle || "",
        title: iv.title,
        scheduledAt: iv.scheduledAt,
        durationMin: iv.durationMin,
        mode: iv.mode,
        status: iv.status,
      })),
    },
  };
};

const getCandidate: ToolExecutor = async (employerId, input) => {
  const candidateId = num(input.candidateId);
  if (candidateId === null) throw new Error("candidateId is required");
  const applicant = await getApplicant(employerId, candidateId);
  if (!applicant) return { targetType: "candidate", targetId: candidateId, data: { found: false } };
  return {
    targetType: "candidate",
    targetId: candidateId,
    data: {
      found: true,
      candidate: {
        id: applicant.id,
        jobId: applicant.jobId,
        jobTitle: applicant.jobTitle || "",
        name: applicant.name,
        email: applicant.email,
        status: applicant.status,
        matchScore: applicant.matchScore,
        notes: applicant.notes,
        createdAt: applicant.createdAt,
      },
    },
  };
};

/** "What needs my attention today?" (Prompt 3) and the daily morning brief
 *  (lib/assistant-brief.ts) share this exact staleness math
 *  (lib/assistant-staleness.ts) so the two surfaces never disagree. */
const getPipelineHealth: ToolExecutor = async (employerId, input) => {
  const jobId = num(input.jobId);
  const jobs: JobPosting[] = jobId !== null ? (await Promise.all([getJob(employerId, jobId)])).filter((j): j is JobPosting => !!j) : await listJobs(employerId);
  const staleDays = assistantStaleDays();
  const perJob: { jobId: number; jobTitle: string; staleCount: number; longestIdle: { id: number; name: string; days: number }[] }[] = [];
  let totalStale = 0;
  for (const job of jobs) {
    const applicants = await listApplicants(employerId, { jobId: job.id });
    const items: StaleCandidateLike[] = applicants.map((a) => ({ id: a.id, name: a.name, jobId: job.id, jobTitle: job.title, status: a.status, statusChangedAt: a.statusChangedAt }));
    const summary = staleSummary(items, staleDays);
    const bucket = summary.byJob.get(job.id);
    perJob.push({ jobId: job.id, jobTitle: job.title, staleCount: bucket?.count || 0, longestIdle: (bucket?.items || []).slice(0, 5) });
    totalStale += bucket?.count || 0;
  }
  return { targetType: jobId !== null ? "job" : null, targetId: jobId, data: { staleDays, totalStale, jobs: perJob } };
};

/** The job/draft title a pending row's card actually shows, for
 *  `get_pending_actions` — `payload.title` for a draft_job_post (always set
 *  by `buildDraftJobPostArtifact`), or the "Job"/"Title" entry off the
 *  artifact's own `resolvedSpecifics` for publish_job and anything else that
 *  carries one, falling back to the artifact's fixed action-label title
 *  (e.g. "Move 2 candidates") when no more specific value exists. */
function pendingActionDisplayTitle(row: PendingActionRow): string {
  const p = row.payload as { title?: unknown };
  if (typeof p.title === "string" && p.title.trim()) return p.title.trim();
  const spec = (row.artifact.resolvedSpecifics || []).find((s) => s.label === "Job" || s.label === "Title");
  if (spec && spec.value) return spec.value;
  return row.artifact.title;
}

/** Whether a pending row's card is currently blocked from approval —
 *  `publish_job`'s artifact always sets `blocked` explicitly, but
 *  `draft_job_post`'s does not (see `buildDraftJobPostArtifact`): it only
 *  surfaces a "⚠ Can't publish yet" entry in `resolvedSpecifics`. Checking
 *  for that entry too means `get_pending_actions` reports blocking
 *  correctly for both, without having to change what's actually stored. */
function pendingActionBlocked(row: PendingActionRow): boolean {
  return !!row.artifact.blocked || (row.artifact.resolvedSpecifics || []).some((s) => s.label.startsWith("⚠"));
}

/** Round 5, Section A: a read-only lookup of this employer's OWN open
 *  approvals inbox — gated like the mutating tools (Scale and up), not the
 *  read-only five, because a pending draft/card is something only a
 *  mutate-capable employer can even create. Exists so the model can tell
 *  "the draft I'm correcting" apart from a real, already-saved job of a
 *  similar name returned by get_jobs — the Oct 23 defect this closes (see
 *  lib/assistant-pending.ts `resolveDraftUpsertTarget`'s header comment).
 *  Surfaces nothing beyond what the employer's own pending-approvals inbox
 *  (GET /api/employer/assistant/actions) already shows them: the artifact's
 *  own resolvedSpecifics, which already carry the blocking validation
 *  message (the "⚠ Can't publish yet" entry) when a card is blocked. */
const getPendingActions: ToolExecutor = async (employerId) => {
  const rows = await listPendingActions(employerId);
  return {
    targetType: null,
    targetId: null,
    data: {
      pendingActions: rows.map((r) => ({
        pendingActionId: r.id,
        action: r.action,
        status: r.status,
        createdAt: r.createdAt,
        title: pendingActionDisplayTitle(r),
        blocked: pendingActionBlocked(r),
        fields: r.artifact.resolvedSpecifics || [],
      })),
    },
  };
};

// ── Mutating tools (Prompt 2) ─────────────────────────────────────────────────
// Every executor below ONLY ever creates a pending-action row
// (lib/assistant-pending.ts) and returns its id — it NEVER touches a job,
// applicant, interview, or message table itself. The real mutation happens
// exactly once, later, when a human approves it (lib/assistant-mutations.ts
// `executePendingAction`, called from the approve route). This split IS the
// enforcement mechanism for "nothing candidate-facing executes inside the
// chat turn", the same way Phase 0's missing mutating executor was the
// enforcement for "the assistant cannot take actions yet".
interface DraftJobPostTargetResolution {
  existing: PendingActionRow | null;
  ambiguousCandidates: DraftUpsertCandidate[] | null;
}

/** Shared upsert-target resolution for anything that creates/updates a
 *  draft_job_post pending row — draft_job_post itself, and (Prompt 5)
 *  start_job_from_playbook, which seeds a draft_job_post row from a role
 *  playbook rather than freehand text. Both reuse the exact same correction
 *  pattern: a `pending_action_id` from THIS conversation, else a
 *  `pending_draft_title`/`title` match against this employer's own pending
 *  drafts (see `resolveDraftUpsertTarget`'s header comment for the fixed
 *  resolution order), else a brand-new draft. */
async function resolveDraftJobPostTarget(employerId: string, input: Record<string, unknown>): Promise<DraftJobPostTargetResolution> {
  // A correction to a card the employer hasn't approved yet (e.g. adding the
  // missing wage range after a blocked publish) updates the SAME row rather
  // than leaving a duplicate behind — only when that row is still pending,
  // still this employer's, and still a draft_job_post (see
  // lib/assistant-pending.ts `updatePendingActionArtifact`). Anything else
  // (wrong employer, wrong action, already resolved) is ignored and falls
  // through to the id-less path below, never a cross-tenant/cross-action
  // overwrite.
  const existingId = str(input.pending_action_id).trim();
  let existing: PendingActionRow | null = null;
  if (existingId) {
    const row = await getPendingActionById(existingId);
    if (row && row.employerId === employerId && row.action === "draft_job_post" && row.status === "pending") existing = row;
  }
  // Fix Round 5, Section B (extended by Fix Round 6, Section A): no usable
  // id (the common case — the correction arrives in a NEW conversation that
  // only has `pending_draft_title`, the draft's name as the employer said
  // it, OR this is a genuinely fresh draft whose own `title` field simply
  // doesn't match anything pending) resolves deterministically against this
  // employer's OWN pending drafts via `resolveDraftUpsertTarget`'s fixed
  // order: pending_draft_title first, then the call's own title, then — only
  // when NEITHER is supplied — the single-pending shortcut. A title given
  // that matches nothing pending always creates a new row; it never falls
  // back to overwriting the lone pending draft just because there's only one.
  if (!existing) {
    const titleHint = str(input.pending_draft_title).trim();
    const incomingTitle = str(input.title).trim();
    const resolution = await resolveDraftUpsertTarget(employerId, titleHint, incomingTitle);
    if (resolution.status === "resolved") return { existing: resolution.row, ambiguousCandidates: null };
    if (resolution.status === "ambiguous") return { existing: null, ambiguousCandidates: resolution.candidates };
  }
  return { existing, ambiguousCandidates: null };
}

const draftJobPost: ToolExecutor = async (employerId, input, ctx) => {
  const { existing, ambiguousCandidates } = await resolveDraftJobPostTarget(employerId, input);
  if (ambiguousCandidates) {
    return {
      targetType: null,
      targetId: null,
      data: {
        resolved: false,
        reason: "ambiguous",
        message: "More than one pending draft matches — ask the employer which one they mean before drafting or updating anything. Offer the candidates list below as options.",
        candidates: ambiguousCandidates,
      },
    };
  }
  const priorRawInput = ((existing?.payload as { rawInput?: Record<string, unknown> } | undefined)?.rawInput) || {};
  const { payload, artifact } = await buildDraftJobPostArtifact(input, priorRawInput);
  if (existing) {
    const updated = await updatePendingActionArtifact(employerId, existing.id, { payload, artifact, irreversible: artifact.irreversible });
    if (updated) return { targetType: null, targetId: null, data: { pendingActionId: updated.id, status: "pending", card: artifact, updated: true } };
  }
  const row = await createPendingAction({ employerId, actorUserId: ctx.actorUserId, action: "draft_job_post", payload, artifact, irreversible: artifact.irreversible });
  if (!row) throw new Error("Could not prepare this job post for approval. Please try again.");
  return { targetType: null, targetId: null, data: { pendingActionId: row.id, status: "pending", card: artifact } };
};

/** Start a new job posting from a ready-made role playbook (Prompt 5,
 *  lib/playbooks.ts) — same draft_job_post pending row, upsert machinery,
 *  and execution path as a freehand draft (lib/assistant-mutations.ts
 *  `executeDraftJobPost`), just seeded from the playbook's skeleton text
 *  instead of model-composed prose, and carrying the playbook's screening
 *  questions + interview kit along for the ride. Always drafts — never
 *  publishes, regardless of what the model passes — a playbook-originated
 *  post always needs the employer's own specifics first. */
const startJobFromPlaybook: ToolExecutor = async (employerId, input, ctx) => {
  const key = str(input.playbook_key).trim();
  const playbook = getPlaybook(key);
  if (!playbook) throw new Error(`Unknown playbook_key "${key}". Valid keys: ${PLAYBOOK_KEYS.join(", ")}.`);

  const { existing, ambiguousCandidates } = await resolveDraftJobPostTarget(employerId, input);
  if (ambiguousCandidates) {
    return {
      targetType: null,
      targetId: null,
      data: {
        resolved: false,
        reason: "ambiguous",
        message: "More than one pending draft matches — ask the employer which one they mean before starting or updating this playbook draft. Offer the candidates list below as options.",
        candidates: ambiguousCandidates,
      },
    };
  }
  const priorRawInput = ((existing?.payload as { rawInput?: Record<string, unknown> } | undefined)?.rawInput) || {};
  // Only set a key here when THIS call actually supplied it — buildDraftJobPostArtifact
  // merges this against priorRawInput as `{...priorRawInput, ...seeded}`, so an
  // explicit `undefined` value (as opposed to the key being absent) would
  // overwrite a chip answer a PRIOR turn already supplied (e.g. hours
  // answered this turn must not blank out a pay range answered last turn).
  const seeded: Record<string, unknown> = { role_description: playbook.skeletonDescription, title: playbook.jobTitle, publish: false };
  if (input.location !== undefined) seeded.location = input.location;
  if (input.pay_range !== undefined) seeded.pay_range = input.pay_range;
  if (input.hours !== undefined) seeded.hours = input.hours;
  if (input.salary_min !== undefined) seeded.salary_min = input.salary_min;
  if (input.salary_max !== undefined) seeded.salary_max = input.salary_max;
  if (input.benefits_description !== undefined) seeded.benefits_description = input.benefits_description;
  const { payload, artifact } = await buildDraftJobPostArtifact(seeded, priorRawInput);
  payload.screeningQuestions = playbook.screeningQuestions;
  payload.interviewKit = playbook.interviewKit;
  payload.playbookKey = playbook.key;
  artifact.resolvedSpecifics = [...(artifact.resolvedSpecifics || []), { label: "Playbook", value: playbook.title }];
  artifact.items = [
    ...artifact.items,
    { id: "screening", label: "Screening questions (included)", artifact: playbook.screeningQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n") },
    {
      id: "kit",
      label: "Interview kit (included)",
      artifact: ["Questions:", ...playbook.interviewKit.questions.map((q, i) => `${i + 1}. ${q}`), "", "Scorecard:", ...playbook.interviewKit.scorecard.map((c) => `• ${c}`)].join("\n"),
    },
  ];

  if (existing) {
    const updated = await updatePendingActionArtifact(employerId, existing.id, { payload, artifact, irreversible: artifact.irreversible });
    if (updated) return { targetType: null, targetId: null, data: { pendingActionId: updated.id, status: "pending", card: artifact, updated: true } };
  }
  const row = await createPendingAction({ employerId, actorUserId: ctx.actorUserId, action: "draft_job_post", payload, artifact, irreversible: artifact.irreversible });
  if (!row) throw new Error("Could not prepare this job post for approval. Please try again.");
  return { targetType: null, targetId: null, data: { pendingActionId: row.id, status: "pending", card: artifact } };
};

/** Generate (or refresh) a grounded interview kit for an EXISTING job
 *  (Prompt 5) — standalone, not tied to any playbook. Refuses, without
 *  creating any pending row, when the job post itself is too thin to ground
 *  real questions in (lib/interview-kits.ts `jobHasEnoughSubstance`) —
 *  returned as a structured, non-throwing result the model can relay,
 *  same shape as `resolveRescheduleCandidate`'s non-match outcomes. */
const createInterviewKit: ToolExecutor = async (employerId, input, ctx) => {
  const jobId = num(input.job_id);
  if (jobId === null) throw new Error("job_id is required.");
  const job = await getJob(employerId, jobId);
  if (!job) throw new Error("That job posting could not be found.");

  if (!jobHasEnoughSubstance(job)) {
    return {
      targetType: "job",
      targetId: jobId,
      data: {
        resolved: false,
        reason: "thin_job",
        message: `"${job.title}" doesn't have enough detail yet to ground a real interview kit in — add a fuller description or a few requirements to the job post first, then ask again.`,
      },
    };
  }

  const existingId = str(input.pending_action_id).trim();
  let existing: PendingActionRow | null = null;
  if (existingId) {
    const row = await getPendingActionById(existingId);
    if (row && row.employerId === employerId && row.action === "create_interview_kit" && row.status === "pending") existing = row;
  }
  if (!existing) existing = await resolvePendingUpsertTarget(employerId, "create_interview_kit", jobId);

  const generated = await generateInterviewKit(job);
  if (!generated) throw new Error("Could not generate an interview kit right now — please try again.");

  const { payload, artifact } = await buildCreateInterviewKitArtifact(jobId, job.title, generated);
  if (existing) {
    const updated = await updatePendingActionArtifact(employerId, existing.id, { payload, artifact, irreversible: false });
    if (updated) return { targetType: "job", targetId: jobId, data: { pendingActionId: updated.id, status: "pending", card: artifact, updated: true } };
  }
  const row = await createPendingAction({ employerId, actorUserId: ctx.actorUserId, action: "create_interview_kit", payload, artifact, irreversible: false });
  if (!row) throw new Error("Could not prepare this interview kit for approval. Please try again.");
  return { targetType: "job", targetId: jobId, data: { pendingActionId: row.id, status: "pending", card: artifact } };
};

/** Plain-language hiring report (Prompt 5) — read-only, Portal tier and up
 *  (same gate as the other six read-only tools, not the mutate-capable
 *  population: it reads, never drafts a card). See lib/hiring-report.ts for
 *  the fact-gathering + anti-fabrication rendering. */
const hiringReport: ToolExecutor = async (employerId, input) => {
  const periodRaw = str(input.period).trim().toLowerCase();
  const period: HiringReportPeriod = periodRaw === "week" || periodRaw === "all" ? periodRaw : "month";
  const result = await buildHiringReport(employerId, period);
  return { targetType: null, targetId: null, data: result };
};

/** Publish an EXISTING job (unlike draft_job_post, which always creates a
 *  NEW one) — see lib/assistant-mutations.ts `buildPublishJobArtifact`'s
 *  header comment for the duplicate-job defect this tool exists to close.
 *  The same pending_action_id correction pattern as draft_job_post applies:
 *  a still-pending publish_job card for this job gets updated in place
 *  rather than leaving a duplicate card behind — and, unlike draft_job_post
 *  (whose single role_description field is always restated in full), a
 *  SECOND correction here must not forget a FIRST one: this merges the
 *  existing pending row's own stored `updates` with whatever field_updates
 *  this call supplies, so correcting the benefits text in a later turn can
 *  never silently drop the wage range a turn earlier already fixed. */
const publishJob: ToolExecutor = async (employerId, input, ctx) => {
  const jobId = num(input.job_id);
  const existingId = str(input.pending_action_id).trim();
  let existing: Awaited<ReturnType<typeof getPendingActionById>> = null;
  if (existingId) {
    const row = await getPendingActionById(existingId);
    if (row && row.employerId === employerId && row.action === "publish_job" && row.status === "pending") existing = row;
  }
  // Fix Round 4, Section A: same id-less fallback as draft_job_post, scoped
  // to the SAME job — a correction arriving in a new conversation ("the wage
  // is $50k-$60k") still lands on the one still-pending publish_job card for
  // job_id, never a second one, even without the model passing its id.
  if (!existing && jobId !== null) existing = await resolvePendingUpsertTarget(employerId, "publish_job", jobId);
  const priorUpdates = ((existing?.payload as { updates?: JobFieldUpdates } | undefined)?.updates || {}) as JobFieldUpdates;
  const { payload, artifact } = await buildPublishJobArtifact(employerId, input, priorUpdates);
  if (existing) {
    const updated = await updatePendingActionArtifact(employerId, existing.id, { payload, artifact, irreversible: artifact.irreversible });
    if (updated) return { targetType: "job", targetId: jobId, data: { pendingActionId: updated.id, status: "pending", card: artifact, updated: true } };
  }
  const row = await createPendingAction({ employerId, actorUserId: ctx.actorUserId, action: "publish_job", payload, artifact, irreversible: artifact.irreversible });
  if (!row) throw new Error("Could not prepare this job for publishing. Please try again.");
  return { targetType: "job", targetId: jobId, data: { pendingActionId: row.id, status: "pending", card: artifact } };
};

const moveCandidates: ToolExecutor = async (employerId, input, ctx) => {
  const { payload, artifact } = await buildMoveCandidatesArtifact(employerId, input);
  const row = await createPendingAction({ employerId, actorUserId: ctx.actorUserId, action: "move_candidates", payload, artifact, irreversible: artifact.irreversible });
  if (!row) throw new Error("Could not prepare this pipeline move for approval. Please try again.");
  return { targetType: "job", targetId: num(input.job_id), data: { pendingActionId: row.id, status: "pending", card: artifact } };
};

const scheduleInterviews: ToolExecutor = async (employerId, input, ctx) => {
  const { payload, artifact } = await buildScheduleInterviewsArtifact(employerId, input);
  const row = await createPendingAction({ employerId, actorUserId: ctx.actorUserId, action: "schedule_interviews", payload, artifact, irreversible: artifact.irreversible });
  if (!row) throw new Error("Could not prepare this interview for approval. Please try again.");
  return { targetType: "job", targetId: num(input.job_id), data: { pendingActionId: row.id, status: "pending", card: artifact } };
};

const messageCandidates: ToolExecutor = async (employerId, input, ctx) => {
  const { payload, artifact } = await buildMessageCandidatesArtifact(employerId, input);
  const row = await createPendingAction({ employerId, actorUserId: ctx.actorUserId, action: "message_candidates", payload, artifact, irreversible: artifact.irreversible });
  if (!row) throw new Error("Could not prepare this message for approval. Please try again.");
  return { targetType: null, targetId: null, data: { pendingActionId: row.id, status: "pending", card: artifact } };
};

const setAckTemplate: ToolExecutor = async (employerId, input, ctx) => {
  // Disabling is the one exception to "every mutation goes through the
  // confirmation card": removing a future send is strictly safer than
  // adding one, so it takes effect the moment the employer asks — no
  // approval, no pending-action row (see
  // lib/assistant-mutations.ts `disableSetAckTemplate`). Setting a NEW or
  // edited template, even to replace a disabled one, always still goes
  // through the normal card below.
  if (input.disable === true) {
    const result = await disableSetAckTemplate(employerId, input);
    return { targetType: result.jobId !== null ? "job" : null, targetId: result.jobId, data: { disabled: result.disabled, message: result.message } };
  }
  const { payload, artifact } = await buildSetAckTemplateArtifact(employerId, input);
  const row = await createPendingAction({ employerId, actorUserId: ctx.actorUserId, action: "set_ack_template", payload, artifact, irreversible: artifact.irreversible });
  if (!row) throw new Error("Could not prepare this template for approval. Please try again.");
  const jobId = num(payload.jobId);
  return { targetType: jobId !== null ? "job" : null, targetId: jobId, data: { pendingActionId: row.id, status: "pending", card: artifact } };
};

const sendOffer: ToolExecutor = async (employerId, input, ctx) => {
  const { payload, artifact } = await buildSendOfferArtifact(employerId, input);
  const row = await createPendingAction({ employerId, actorUserId: ctx.actorUserId, action: "send_offer", payload, artifact, irreversible: artifact.irreversible });
  if (!row) throw new Error("Could not prepare this offer for approval. Please try again.");
  return { targetType: "candidate", targetId: num(input.candidate_id), data: { pendingActionId: row.id, status: "pending", card: artifact } };
};

/** Employer-initiated reschedule, via chat (Fix Round 3, Section A) — distinct
 *  from the candidate-email-reply path (lib/assistant-inbound.ts), which
 *  already knows the exact interviewId from its reply token and never goes
 *  through this tool. Here the candidate is named in plain text, so this
 *  resolves it first (lib/assistant-mutations.ts `resolveRescheduleCandidate`)
 *  against real scheduled interviews — a name match of zero or more than one
 *  returns candidate options for the model to present as a clarifying
 *  question INSTEAD of a thrown, dead-end error. Once resolved, this reuses
 *  the exact same card → approve → `executeRescheduleInterview` pipeline as
 *  the email path, so the interview is moved, never duplicated, by
 *  construction. */
const rescheduleInterview: ToolExecutor = async (employerId, input, ctx) => {
  const candidateId = num(input.candidate_id);
  const candidateName = str(input.candidate_name).trim();
  const jobId = num(input.job_id);
  const newTimeRaw = str(input.new_time).trim();
  if (!newTimeRaw) throw new Error("new_time is required — the proposed new interview date/time (ISO-8601, in absolute UTC).");
  const newTimeMs = new Date(newTimeRaw).getTime();
  if (!Number.isFinite(newTimeMs)) throw new Error("new_time must be a valid ISO-8601 date/time.");
  if (candidateId === null && !candidateName) throw new Error("Provide candidate_id or candidate_name to identify whose interview to reschedule.");

  const resolution = await resolveRescheduleCandidate(employerId, { candidateId, candidateName, jobId });
  if (resolution.status !== "resolved") {
    return {
      targetType: null,
      targetId: null,
      data: {
        resolved: false,
        reason: resolution.status,
        message:
          resolution.status === "ambiguous"
            ? `More than one scheduled interview matches "${candidateName}" — ask the employer which one they mean before drafting anything.`
            : candidateName
              ? `No scheduled interview matches "${candidateName}". Offer the candidates list below as options rather than saying nothing can be found.`
              : "No candidate was identified. Offer the candidates list below as options.",
        candidates: resolution.candidates,
      },
    };
  }

  const { payload, artifact } = await buildChatRescheduleArtifact({
    employerId,
    interviewId: resolution.interviewId!,
    candidateName: resolution.candidateName!,
    currentScheduledAt: resolution.currentScheduledAt!,
    newScheduledAt: new Date(newTimeMs).toISOString(),
  });

  const existingId = str(input.pending_action_id).trim();
  if (existingId) {
    const existing = await getPendingActionById(existingId);
    if (existing && existing.employerId === employerId && existing.action === "reschedule_interview" && existing.status === "pending") {
      const updated = await updatePendingActionArtifact(employerId, existingId, { payload, artifact, irreversible: artifact.irreversible });
      if (updated) return { targetType: "interview", targetId: resolution.interviewId!, data: { pendingActionId: updated.id, status: "pending", card: artifact, updated: true } };
    }
  }
  const row = await createPendingAction({ employerId, actorUserId: ctx.actorUserId, action: "reschedule_interview", payload, artifact, irreversible: artifact.irreversible });
  if (!row) throw new Error("Could not prepare this reschedule for approval. Please try again.");
  return { targetType: "interview", targetId: resolution.interviewId!, data: { pendingActionId: row.id, status: "pending", card: artifact } };
};

/** The seven Phase-0/Prompt-3/Prompt-5 read-only tools never need a human
 *  approval step — keep this list in sync with the read-only slice of
 *  ASSISTANT_TOOL_DEFS below. Used by lib/assistant-chat.ts to decide which
 *  tools a Portal-tier (not yet Scale-tier) employer's turn is even offered.
 *  Deliberately does NOT include get_pending_actions (Fix Round 5, Section
 *  A): though it mutates nothing itself, a pending card is only ever
 *  something a mutate-capable employer could have created, so it is gated
 *  exactly like the mutating tools below — same population
 *  (canAssistantMutate), not this one. hiring_report (Prompt 5) IS in this
 *  list — it only reads, same as the other six, so Portal tier gets it too. */
export const READ_ONLY_TOOL_NAMES: readonly string[] = ["get_jobs", "summarize_candidates", "summarize_pipeline", "get_schedule", "get_candidate", "get_pipeline_health", "hiring_report"];

/** Tool definitions sent to Claude (Anthropic tool-use): the seven read-only
 *  lookups (Portal tier and up) plus get_pending_actions and the ten
 *  mutating tools (Scale tier and up — lib/assistant-chat.ts filters these
 *  out of the tools array for a sub-Scale employer, so the model is never
 *  even offered them). */
export const ASSISTANT_TOOL_DEFS: AssistantToolDef[] = [
  {
    name: "get_jobs",
    description:
      "List this employer's job postings, optionally filtered by jobId or status (draft/active/closed). Also answers 'what's the status of job X' — status is a field on each returned job.",
    input_schema: {
      type: "object",
      properties: {
        jobId: { type: "number", description: "Return only this job, by id." },
        status: { type: "string", description: "Filter to jobs with this status (e.g. 'active', 'draft', 'closed')." },
      },
    },
  },
  {
    name: "summarize_candidates",
    description: "List every candidate who applied to one job posting, with their current status, match score, and application date.",
    input_schema: {
      type: "object",
      properties: { jobId: { type: "number", description: "The job posting id." } },
      required: ["jobId"],
    },
  },
  {
    name: "summarize_pipeline",
    description: "Get the candidate pipeline funnel for one job posting: how many candidates are at each stage (new, reviewed, shortlisted, interviewed, offer extended, hired, rejected).",
    input_schema: {
      type: "object",
      properties: { jobId: { type: "number", description: "The job posting id." } },
      required: ["jobId"],
    },
  },
  {
    name: "get_schedule",
    description: "List scheduled interviews between two ISO-8601 dates/times (inclusive).",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "ISO-8601 start of the range." },
        end: { type: "string", description: "ISO-8601 end of the range." },
      },
      required: ["start", "end"],
    },
  },
  {
    name: "get_candidate",
    description: "Get full detail on one candidate by id: name, email, status, match score, notes, and which job they applied to.",
    input_schema: {
      type: "object",
      properties: { candidateId: { type: "number", description: "The candidate's (applicant) id." } },
      required: ["candidateId"],
    },
  },
  {
    name: "get_pipeline_health",
    description:
      "Get pipeline STALENESS: candidates whose pipeline stage hasn't changed in a while (the assistant's daily morning brief surfaces the same thing). Use this to answer 'what needs my attention today' or 'what's gone stale'. Omit jobId for every job this employer has.",
    input_schema: {
      type: "object",
      properties: { jobId: { type: "number", description: "Limit to one job posting. Omit for all jobs." } },
    },
  },
  {
    name: "hiring_report",
    description:
      "Get a plain-language hiring report: new applicants per job, the pipeline funnel (counts per stage), time-to-fill for roles filled in the period, the longest-idle pipeline items, and an average response-time figure when there's enough data for one. Use this for anything like 'how is hiring going', 'give me a hiring report', or 'how are we doing this month'. Present the returned `report` text to the employer, then list the `sourceNumbers` it returns beneath it so they can check the figures themselves — never recompute, round differently, or restate those numbers in your own words.",
    input_schema: {
      type: "object",
      properties: { period: { type: "string", description: "'week', 'month', or 'all'. Defaults to 'month'." } },
    },
  },
  {
    name: "get_pending_actions",
    description:
      "List this employer's OWN pending approval cards — drafts, publishes, pipeline moves, scheduled interviews, messages, and offers the assistant has already prepared but the employer hasn't approved yet. Each entry has a pending_action_id, its title, its current field values, and, for a blocked draft or publish, the exact validation error holding it back. ALWAYS call this FIRST — before get_jobs or any other lookup — whenever the employer refers to 'the draft', 'that pending post', 'my pending card', or is correcting something that isn't approved yet: a pending draft is NOT a job row and will never show up in get_jobs, so skipping this risks mistaking an unrelated real job of a similar name for the draft being corrected. Only offered on the Scale plan.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "draft_job_post",
    description:
      "Draft a new job posting for this employer. Compose the FULL job description yourself and pass it as role_description — there is no separate writer behind this tool. Calling this never publishes or saves anything by itself: it only prepares a confirmation card the employer must approve. Set publish=true only if the employer explicitly asked to make it live now; otherwise it stays an unpublished draft. Publishing requires salary_min, salary_max, and benefits_description (the same wage-transparency rule the hand-driven job form enforces) — ask the employer for these before setting publish=true, or the card will show it can't go live yet. If the employer is now supplying what was missing on a card you already drafted THIS conversation that is still awaiting approval (e.g. 'the wage is $50k-$60k' right after a blocked-publish card), pass that card's pending_action_id so this UPDATES the same card instead of creating a second one — never leave two cards open for what is really one correction. If the correction instead arrives in a NEW conversation where you don't have that id, call get_pending_actions first to see what's actually pending, then pass pending_draft_title with the draft's name as the employer described it — never fabricate or guess at a pending_action_id you don't actually have, and never substitute a real, already-posted job of a similar name from get_jobs for a pending, unapproved draft.",
    input_schema: {
      type: "object",
      properties: {
        role_description: { type: "string", description: "The full job post body text you've composed." },
        title: { type: "string", description: "Job title. If omitted, inferred from role_description." },
        location: { type: "string" },
        pay_range: { type: "string", description: "Free-text display string, e.g. '$70,000–$90,000/year'. Not used for the publish check — set salary_min/salary_max for that." },
        hours: { type: "string", description: "e.g. 'Full-time, Mon–Fri'." },
        salary_min: { type: "number", description: "Minimum wage/salary as a number (required to publish). For a fixed wage, use the same value as salary_max." },
        salary_max: { type: "number", description: "Maximum wage/salary as a number (required to publish)." },
        benefits_description: { type: "string", description: "General benefits description, e.g. 'Health insurance, 401(k), paid leave.' (required to publish)." },
        publish: { type: "boolean", description: "true to publish live on approval; default false (draft only)." },
        pending_action_id: { type: "string", description: "Only when correcting a still-pending card from earlier in THIS conversation — updates that same card instead of drafting a new one. Omit when drafting a brand-new job post." },
        pending_draft_title: {
          type: "string",
          description:
            "Only when correcting a pending draft from a DIFFERENT conversation where you don't have its pending_action_id — the draft's title (or your best guess at it) as the employer described it, e.g. 'the warehouse associate draft'. Call get_pending_actions first rather than guessing blindly. If more than one pending draft could match, the result comes back unresolved with a list of candidates — ask the employer which one they mean instead of picking one yourself. Omit when pending_action_id is given, or when drafting a brand-new job post with no correction in mind.",
        },
      },
      required: ["role_description"],
    },
  },
  {
    name: "start_job_from_playbook",
    description: `Start a new job posting from a ready-made ROLE PLAYBOOK — a pre-written skeleton description, screening questions, and a complete interview kit for a common hiring need. Use this the moment the employer says something like "I need to hire a personal assistant" / "I want to hire a dental hygienist" / "I need a dispatcher" / "I'm hiring an HVAC tech" / "I need a server" — recognize the role from the employer's own words and pass the matching playbook_key, rather than drafting the whole thing yourself from scratch with draft_job_post. Valid playbook_key values: ${playbookKeyList()}. This NEVER publishes — it always prepares an unpublished DRAFT job posting for approval, pre-loaded with the playbook's screening questions and interview kit. Ask the employer for hours, a pay range, and location if they haven't said; pass what you have as salary_min/salary_max/pay_range/hours/location and omit what you don't have yet. If the employer is now supplying something that was missing on a card you already started THIS conversation, pass that card's pending_action_id so this updates the SAME card instead of starting a second one. If the correction arrives in a different conversation where you don't have that id, call get_pending_actions first, then pass pending_draft_title.`,
    input_schema: {
      type: "object",
      properties: {
        playbook_key: { type: "string", description: `One of: ${PLAYBOOK_KEYS.join(", ")}.` },
        location: { type: "string" },
        pay_range: { type: "string", description: "Free-text display string, e.g. '$18–$22/hour'. Not used for the publish check — set salary_min/salary_max for that." },
        hours: { type: "string", description: "e.g. 'Full-time, Mon–Fri'." },
        salary_min: { type: "number", description: "Minimum wage/salary as a number." },
        salary_max: { type: "number", description: "Maximum wage/salary as a number." },
        benefits_description: { type: "string", description: "General benefits description, e.g. 'Health insurance, 401(k), paid leave.'" },
        pending_action_id: { type: "string", description: "Only when correcting a still-pending card from earlier in THIS conversation. Omit when starting a brand-new playbook draft." },
        pending_draft_title: {
          type: "string",
          description: "Only when correcting a pending draft from a DIFFERENT conversation where you don't have its pending_action_id. Call get_pending_actions first rather than guessing blindly.",
        },
      },
      required: ["playbook_key"],
    },
  },
  {
    name: "publish_job",
    description:
      "Publish an EXISTING job posting that already has an id — use this whenever the employer asks to publish/post/make live a job that already exists (e.g. a draft from the portal's job form, or one draft_job_post already created), rather than draft_job_post, which always creates a brand NEW job and would duplicate it. Look up the job first (e.g. with get_jobs) if you don't already know its id. Optionally pass field_updates to fix fields in the same call — e.g. the employer says 'publish it, the wage is $50k-$60k' right after you tell them it's missing pay. Checks the SAME pay-transparency + board-quality gate the hand-driven jobs route enforces; if something is still missing, the card shows the exact validation error and approval stays blocked until it's fixed — it never creates a second job. If correcting a card you already drafted THIS conversation that is still awaiting approval, pass that card's pending_action_id so this updates the same card instead of creating a second one.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "number", description: "The existing job posting's id." },
        field_updates: {
          type: "object",
          description: "Fields to change on the job before publishing. Only pass what's actually changing — everything else stays as already saved on the job.",
          properties: {
            title: { type: "string" },
            location: { type: "string" },
            department: { type: "string" },
            description: { type: "string", description: "Full job post body text, if it needs rewriting." },
            salary_min: { type: "number", description: "Minimum wage/salary as a number (required to publish). For a fixed wage, use the same value as salary_max." },
            salary_max: { type: "number", description: "Maximum wage/salary as a number (required to publish)." },
            benefits_description: { type: "string", description: "General benefits description, e.g. 'Health insurance, 401(k), paid leave.' (required to publish)." },
          },
        },
        pending_action_id: { type: "string", description: "Only when correcting a still-pending publish_job card from earlier in THIS conversation. Omit when publishing a job for the first time in this conversation." },
      },
      required: ["job_id"],
    },
  },
  {
    name: "move_candidates",
    description:
      "Move one or more candidates on one job posting to a new pipeline stage (new, reviewed, shortlisted, interviewed, offer extended, hired, rejected). Resolve exactly which job and which candidates first (e.g. with summarize_candidates) — never guess. This only prepares a confirmation card; nothing moves until the employer approves.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "number" },
        candidate_ids: { type: "array", items: { type: "number" } },
        to_stage: { type: "string", description: "One of: new, reviewed, shortlisted, interviewed, offer extended, hired, rejected." },
      },
      required: ["job_id", "candidate_ids", "to_stage"],
    },
  },
  {
    name: "schedule_interviews",
    description:
      "Propose an interview slot for one or more candidates on one job posting. Checks the calendar for clashes and shows them on the card before approval. This only prepares a confirmation card; nothing is scheduled until the employer approves.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "number" },
        candidate_ids: { type: "array", items: { type: "number" } },
        scheduled_at: { type: "string", description: "ISO-8601 date/time." },
        duration_min: { type: "number" },
        mode: { type: "string", description: "video, phone, or onsite." },
      },
      required: ["job_id", "candidate_ids", "scheduled_at"],
    },
  },
  {
    name: "message_candidates",
    description:
      "Draft a message to one or more candidates — either an explicit candidate_ids list, or a filter ({job_id, status}) that this tool resolves to a concrete, named list on the card before anything can be approved. Write the exact final message body yourself in `message` (optionally with {{firstName}} to personalize per candidate). This only prepares a confirmation card; nothing sends until the employer approves, and even then there is a short undo window before it reaches anyone. To draft in a different language, set `language` (default 'en'; currently also supports 'es' for Spanish) and write `message` directly in that language — then you MUST also pass `gloss_en`: a complete, faithful English back-translation of the exact message you wrote, never omitting a detail like pay, dates, or conditions. The employer approves by reading that gloss, so it has to say everything the real message says — the card shows both, clearly labeled, side by side.",
    input_schema: {
      type: "object",
      properties: {
        candidate_ids: { type: "array", items: { type: "number" } },
        filter: {
          type: "object",
          properties: { job_id: { type: "number" }, status: { type: "string" } },
          description: "Resolve to every candidate on job_id, optionally filtered to one pipeline status.",
        },
        message: { type: "string", description: "The full message body, written in `language`." },
        language: { type: "string", description: "'en' (default) or 'es' for Spanish. When not 'en', gloss_en is required." },
        gloss_en: { type: "string", description: "Required when language is not 'en' — a complete, faithful English back-translation of `message`. Never required for language 'en'." },
      },
      required: ["message"],
    },
  },
  {
    name: "set_ack_template",
    description:
      "Set up a STANDING auto-acknowledgment message that fires automatically on every new application from now on, with ZERO further approval per message — approving this exact template text IS the approval for every future send. Write the complete, final message body yourself (optionally with {{firstName}}). Only use this when the employer explicitly asks for a standing/automatic acknowledgment for new applicants (e.g. 'send everyone who applies a quick thanks') — not for a one-off message, which is message_candidates instead. Omit job_id for account-wide (every job); set it to scope to one job posting. Only one standing template can be active per scope — approving a new one for the same scope replaces the old one (editing is just approving a new version). To turn OFF a standing acknowledgment — the employer says something like 'stop the auto-replies', 'disable the acknowledgment', 'turn that off' — pass disable=true (with job_id to target one job, or omit for account-wide) instead of a template. Disabling takes effect IMMEDIATELY with no approval card, because removing a future send is strictly safer than adding one; setting a new or edited template always still requires approval, even to replace one you just disabled.",
    input_schema: {
      type: "object",
      properties: {
        template: { type: "string", description: "The exact message body sent to every new applicant going forward. Optionally include {{firstName}} to personalize. Not needed when disable is true." },
        job_id: { type: "number", description: "Scope to one job posting. Omit for account-wide (every job)." },
        disable: { type: "boolean", description: "Set true to immediately turn OFF the standing acknowledgment for this scope — takes effect right away, no approval needed, no template required." },
      },
      required: [],
    },
  },
  {
    name: "send_offer",
    description:
      "Send an offer letter to a candidate for e-signature via DocuSign. The card shows the complete offer summary (recipient, position, salary, start date, message) before anything is sent. Resolve the exact candidate first (e.g. with get_candidate) — never guess. This only prepares a confirmation card; the real DocuSign envelope is only created once the employer approves, and it can't be unsent after that.",
    input_schema: {
      type: "object",
      properties: {
        candidate_id: { type: "number", description: "The candidate's (applicant) id." },
        position: { type: "string", description: "The job title being offered." },
        salary: { type: "string", description: "e.g. '$85,000/year'." },
        start_date: { type: "string" },
        extra_terms: { type: "string", description: "Bonus, equity, benefits, conditions — free text." },
        message: { type: "string", description: "A personal message included with the offer." },
        subject: { type: "string", description: "Email subject. If omitted, a sensible default is used." },
      },
      required: ["candidate_id", "position"],
    },
  },
  {
    name: "reschedule_interview",
    description:
      "Move an EXISTING scheduled interview to a new time — use this whenever the employer asks to reschedule/move/change the time of an interview that's already on the calendar, never schedule_interviews (which always creates a NEW interview and would leave the old one in place as a duplicate). Identify the candidate by candidate_id if you already know it (e.g. from get_schedule or get_candidate), or by candidate_name otherwise — resolution is case-insensitive and tolerant of a partial name. If the result comes back with resolved=false, do NOT tell the employer no candidate could be found — the result includes a `candidates` list of everyone who currently has a scheduled interview; read it back to the employer as options (e.g. 'Did you mean Maria Alvarez or Maria Chen?') and call this again once they pick, passing candidate_id. This only prepares a confirmation card; the interview isn't actually moved until the employer approves, and the candidate gets exactly one 'rescheduled' notification on approval — never a fresh 'scheduled' one.",
    input_schema: {
      type: "object",
      properties: {
        candidate_id: { type: "number", description: "The candidate's (applicant) id, if already known — skips name resolution entirely." },
        candidate_name: { type: "string", description: "The candidate's name as the employer said it. Omit if candidate_id is given." },
        job_id: { type: "number", description: "Optional — narrow resolution to one job posting if the name alone is ambiguous across jobs." },
        new_time: { type: "string", description: "The new interview date/time, as an absolute ISO-8601 string (with a 'Z' or explicit offset — never a bare local time)." },
        pending_action_id: { type: "string", description: "Only when correcting a still-pending reschedule_interview card from earlier in THIS conversation. Omit otherwise." },
      },
      required: ["new_time"],
    },
  },
  {
    name: "create_interview_kit",
    description:
      "Generate (or refresh) a grounded interview kit for an EXISTING job posting — a set of interview questions plus scorecard criteria, based ONLY on that job's own title, description, and requirements (never invented). Use this whenever the employer asks for interview questions or a scorecard for a specific job. If the job post doesn't have enough real detail to ground questions in, the result comes back unresolved (resolved: false, reason: 'thin_job') with a message to relay — tell the employer plainly and suggest they flesh out the post first, rather than inventing generic questions yourself. This only prepares a confirmation card; nothing is stored until the employer approves. If correcting a card you already generated THIS conversation that is still awaiting approval, pass that card's pending_action_id so this updates the same card instead of creating a second one.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "number", description: "The existing job posting's id." },
        pending_action_id: { type: "string", description: "Only when correcting a still-pending create_interview_kit card from earlier in THIS conversation. Omit otherwise." },
      },
      required: ["job_id"],
    },
  },
];

export const ASSISTANT_TOOL_NAMES: readonly string[] = ASSISTANT_TOOL_DEFS.map((t) => t.name);

export const ASSISTANT_TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  get_jobs: getJobs,
  summarize_candidates: summarizeCandidates,
  summarize_pipeline: summarizePipeline,
  get_schedule: getSchedule,
  get_candidate: getCandidate,
  get_pipeline_health: getPipelineHealth,
  hiring_report: hiringReport,
  get_pending_actions: getPendingActions,
  draft_job_post: draftJobPost,
  start_job_from_playbook: startJobFromPlaybook,
  publish_job: publishJob,
  move_candidates: moveCandidates,
  schedule_interviews: scheduleInterviews,
  message_candidates: messageCandidates,
  set_ack_template: setAckTemplate,
  send_offer: sendOffer,
  reschedule_interview: rescheduleInterview,
  create_interview_kit: createInterviewKit,
};
