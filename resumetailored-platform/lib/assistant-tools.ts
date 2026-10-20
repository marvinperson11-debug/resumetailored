import { listJobs, listApplicants, getApplicant } from "./employer-store";
import { listInterviews } from "./employer-collab-store";
import type { Applicant, ApplicantStatus, JobPosting } from "./employer-ai";

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

export type ToolExecutor = (employerId: string, input: Record<string, unknown>) => Promise<ToolResult>;

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

/** Tool definitions sent to Claude (Anthropic tool-use). Keep this list to
 *  EXACTLY the five read-only tools in this phase — scripts/test-employer-assistant.cjs
 *  asserts the registry's shape, so an accidental mutating tool added here
 *  fails CI loudly instead of shipping quietly. */
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
];

export const ASSISTANT_TOOL_NAMES: readonly string[] = ASSISTANT_TOOL_DEFS.map((t) => t.name);

export const ASSISTANT_TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  get_jobs: getJobs,
  summarize_candidates: summarizeCandidates,
  summarize_pipeline: summarizePipeline,
  get_schedule: getSchedule,
  get_candidate: getCandidate,
};
