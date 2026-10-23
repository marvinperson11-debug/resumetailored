import { listJobs, getJob, listApplicants, getApplicant } from "./employer-store";
import { listInterviews } from "./employer-collab-store";
import type { Applicant, ApplicantStatus, JobPosting } from "./employer-ai";
import { createPendingAction, getPendingActionById, updatePendingActionArtifact } from "./assistant-pending";
import {
  buildDraftJobPostArtifact,
  buildMoveCandidatesArtifact,
  buildScheduleInterviewsArtifact,
  buildMessageCandidatesArtifact,
  buildSetAckTemplateArtifact,
  buildSendOfferArtifact,
  disableSetAckTemplate,
} from "./assistant-mutations";
import { assistantStaleDays, staleSummary, type StaleCandidateLike } from "./assistant-staleness";

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

// ── Mutating tools (Prompt 2) ─────────────────────────────────────────────────
// Every executor below ONLY ever creates a pending-action row
// (lib/assistant-pending.ts) and returns its id — it NEVER touches a job,
// applicant, interview, or message table itself. The real mutation happens
// exactly once, later, when a human approves it (lib/assistant-mutations.ts
// `executePendingAction`, called from the approve route). This split IS the
// enforcement mechanism for "nothing candidate-facing executes inside the
// chat turn", the same way Phase 0's missing mutating executor was the
// enforcement for "the assistant cannot take actions yet".
const draftJobPost: ToolExecutor = async (employerId, input, ctx) => {
  const { payload, artifact } = await buildDraftJobPostArtifact(input);
  // A correction to a card the employer hasn't approved yet (e.g. adding the
  // missing wage range after a blocked publish) updates the SAME row rather
  // than leaving a duplicate behind — only when that row is still pending,
  // still this employer's, and still a draft_job_post (see
  // lib/assistant-pending.ts `updatePendingActionArtifact`). Anything else
  // (wrong employer, wrong action, already resolved) is ignored and falls
  // through to drafting a fresh row, never a cross-tenant/cross-action
  // overwrite.
  const existingId = str(input.pending_action_id).trim();
  if (existingId) {
    const existing = await getPendingActionById(existingId);
    if (existing && existing.employerId === employerId && existing.action === "draft_job_post" && existing.status === "pending") {
      const updated = await updatePendingActionArtifact(employerId, existingId, { payload, artifact, irreversible: artifact.irreversible });
      if (updated) return { targetType: null, targetId: null, data: { pendingActionId: updated.id, status: "pending", card: artifact, updated: true } };
    }
  }
  const row = await createPendingAction({ employerId, actorUserId: ctx.actorUserId, action: "draft_job_post", payload, artifact, irreversible: artifact.irreversible });
  if (!row) throw new Error("Could not prepare this job post for approval. Please try again.");
  return { targetType: null, targetId: null, data: { pendingActionId: row.id, status: "pending", card: artifact } };
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

/** The five Phase-0 tools never need a human approval step — keep this list
 *  in sync with the read-only slice of ASSISTANT_TOOL_DEFS below. Used by
 *  lib/assistant-chat.ts to decide which tools a Portal-tier (not yet
 *  Scale-tier) employer's turn is even offered. */
export const READ_ONLY_TOOL_NAMES: readonly string[] = ["get_jobs", "summarize_candidates", "summarize_pipeline", "get_schedule", "get_candidate", "get_pipeline_health"];

/** Tool definitions sent to Claude (Anthropic tool-use): the five read-only
 *  lookups (Portal tier and up) plus the four mutating tools (Scale tier and
 *  up — lib/assistant-chat.ts filters these out of the tools array for a
 *  sub-Scale employer, so the model is never even offered them). */
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
    name: "draft_job_post",
    description:
      "Draft a new job posting for this employer. Compose the FULL job description yourself and pass it as role_description — there is no separate writer behind this tool. Calling this never publishes or saves anything by itself: it only prepares a confirmation card the employer must approve. Set publish=true only if the employer explicitly asked to make it live now; otherwise it stays an unpublished draft. Publishing requires salary_min, salary_max, and benefits_description (the same wage-transparency rule the hand-driven job form enforces) — ask the employer for these before setting publish=true, or the card will show it can't go live yet. If the employer is now supplying what was missing on a card you already drafted THIS conversation that is still awaiting approval (e.g. 'the wage is $50k-$60k' right after a blocked-publish card), pass that card's pending_action_id so this UPDATES the same card instead of creating a second one — never leave two cards open for what is really one correction.",
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
      },
      required: ["role_description"],
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
      "Draft a message to one or more candidates — either an explicit candidate_ids list, or a filter ({job_id, status}) that this tool resolves to a concrete, named list on the card before anything can be approved. Write the exact final message body yourself in `message` (optionally with {{firstName}} to personalize per candidate). This only prepares a confirmation card; nothing sends until the employer approves, and even then there is a short undo window before it reaches anyone.",
    input_schema: {
      type: "object",
      properties: {
        candidate_ids: { type: "array", items: { type: "number" } },
        filter: {
          type: "object",
          properties: { job_id: { type: "number" }, status: { type: "string" } },
          description: "Resolve to every candidate on job_id, optionally filtered to one pipeline status.",
        },
        message: { type: "string", description: "The full message body." },
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
];

export const ASSISTANT_TOOL_NAMES: readonly string[] = ASSISTANT_TOOL_DEFS.map((t) => t.name);

export const ASSISTANT_TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  get_jobs: getJobs,
  summarize_candidates: summarizeCandidates,
  summarize_pipeline: summarizePipeline,
  get_schedule: getSchedule,
  get_candidate: getCandidate,
  get_pipeline_health: getPipelineHealth,
  draft_job_post: draftJobPost,
  move_candidates: moveCandidates,
  schedule_interviews: scheduleInterviews,
  message_candidates: messageCandidates,
  set_ack_template: setAckTemplate,
  send_offer: sendOffer,
};
