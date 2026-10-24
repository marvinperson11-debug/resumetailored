import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk"; // type-only: see generateInterviewKit
import { MIN_DESCRIPTION_CHARS } from "./job-quality";
import type { JobPosting } from "./employer-ai";

/**
 * Interview kits (Prompt 5) — one set of interview questions + scorecard
 * criteria per job, stored in job_interview_kits (migration 0066). A kit
 * comes from exactly one of two sources, never a third:
 *
 *   - create_interview_kit (lib/assistant-tools.ts): one capped LLM call,
 *     grounded ONLY in the job's own title/description/requirements —
 *     `generateInterviewKit` below. Stored with source 'llm'.
 *   - start_job_from_playbook: the matching lib/playbooks.ts kit, verbatim,
 *     no LLM call at all. Stored with source 'playbook'
 *     (lib/assistant-mutations.ts `executeDraftJobPost`).
 *
 * `job_id` is the table's primary key — a second generation or playbook for
 * the same job REPLACES the kit rather than accumulating a history; there is
 * no versioning requirement in this prompt.
 */

let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export type InterviewKitSource = "llm" | "playbook";

export interface InterviewKitContent {
  questions: string[];
  scorecard: string[];
}

export interface InterviewKitRow extends InterviewKitContent {
  jobId: number;
  employerId: string;
  source: InterviewKitSource;
  createdAt: string;
}

const MIN_KIT_QUESTIONS = 6;
const MAX_KIT_QUESTIONS = 8;
const MIN_KIT_CRITERIA = 4;
const MAX_KIT_CRITERIA = 6;

/** Same "thin listing" threshold the public-board quality gate uses
 *  (lib/job-quality.ts `MIN_DESCRIPTION_CHARS`) — a job post this short (and
 *  with no requirements listed either) has nothing real for an interview
 *  kit to be grounded in. Used by create_interview_kit's refusal path
 *  (lib/assistant-tools.ts) — never by start_job_from_playbook, which has no
 *  job yet to check (it's seeding a brand-new draft). */
export function jobHasEnoughSubstance(job: Pick<JobPosting, "description" | "requirements">): boolean {
  return job.description.trim().length >= MIN_DESCRIPTION_CHARS || job.requirements.length > 0;
}

export async function saveInterviewKit(employerId: string, jobId: number, kit: InterviewKitContent, source: InterviewKitSource): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !jobId) return false;
  try {
    const { error } = await c
      .from("job_interview_kits")
      .upsert({ job_id: jobId, employer_id: employerId, questions: kit.questions, scorecard: kit.scorecard, source, created_at: new Date().toISOString() }, { onConflict: "job_id" });
    return !error;
  } catch {
    return false;
  }
}

export async function getInterviewKit(employerId: string, jobId: number): Promise<InterviewKitRow | null> {
  const c = db();
  if (!c || !employerId || !jobId) return null;
  try {
    const { data } = await c.from("job_interview_kits").select("*").eq("employer_id", employerId).eq("job_id", jobId).maybeSingle();
    if (!data) return null;
    return {
      jobId: data.job_id as number,
      employerId: (data.employer_id as string) || "",
      questions: Array.isArray(data.questions) ? data.questions.map(String) : [],
      scorecard: Array.isArray(data.scorecard) ? data.scorecard.map(String) : [],
      source: data.source === "playbook" ? "playbook" : "llm",
      createdAt: (data.created_at as string) || "",
    };
  } catch {
    return null;
  }
}

function cleanList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, max);
}

/**
 * One capped LLM call, grounded ONLY in the job's own title/description/
 * requirements — never invents a skill, tool, or requirement the posting
 * doesn't actually mention. Null on ANY failure (no API key, upstream
 * error, empty/malformed JSON, too few questions/criteria to be useful) —
 * the caller (create_interview_kit, lib/assistant-tools.ts) surfaces that as
 * "could not generate right now". Unlike the daily brief
 * (lib/assistant-brief.ts), there is deliberately no template fallback here:
 * a GENERIC kit not grounded in this job would be exactly the fabrication
 * this rule forbids, so a failed call means no kit, not a fake one.
 */
export async function generateInterviewKit(job: Pick<JobPosting, "title" | "description" | "requirements">): Promise<InterviewKitContent | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
    const anthropic = new AnthropicClient({ apiKey });
    const res = await anthropic.messages.create({
      model: process.env.ASSISTANT_MODEL || "claude-sonnet-4-6",
      max_tokens: 800,
      system: `You write interview kits for hiring managers. Base every question and scorecard criterion ONLY on the job's own title, description, and requirements given in the user message — never invent a skill, tool, or requirement the posting doesn't mention. Output ONLY valid JSON, no markdown: {"questions": string[], "scorecard": string[]}. Write ${MIN_KIT_QUESTIONS}-${MAX_KIT_QUESTIONS} open-ended interview questions and ${MIN_KIT_CRITERIA}-${MAX_KIT_CRITERIA} short scorecard criteria (2-5 words each) a hiring manager can rate a candidate against. Never ask about age, religion, marital or family status, pregnancy, national origin, or disability.`,
      messages: [{ role: "user", content: JSON.stringify({ title: job.title, description: job.description, requirements: job.requirements }) }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) return null;
    const parsed = JSON.parse(text) as { questions?: unknown; scorecard?: unknown };
    const questions = cleanList(parsed.questions, MAX_KIT_QUESTIONS);
    const scorecard = cleanList(parsed.scorecard, MAX_KIT_CRITERIA);
    if (questions.length < MIN_KIT_QUESTIONS || scorecard.length < MIN_KIT_CRITERIA) return null;
    return { questions, scorecard };
  } catch {
    return null;
  }
}
