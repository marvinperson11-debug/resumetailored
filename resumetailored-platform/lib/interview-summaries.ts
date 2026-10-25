import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk"; // type-only: see generateInterviewSummary
import { extractJson } from "./tools-ai";
import type { InterviewKitContent } from "./interview-kits";

/**
 * Video-interview summarization against a stored interview kit (Prompt 6,
 * Section 2) — `interview_summaries` (migration 0068). `summarize_interview`
 * (lib/assistant-tools.ts / lib/assistant-mutations.ts) scores a PASTED
 * transcript against the job's own saved kit (job_interview_kits.scorecard)
 * with one capped LLM call; the employer still scores/decides — this is
 * advisory, never a hiring decision.
 *
 * V1 boundary (deliberate, see the Prompt 6 report): the input is a
 * transcript the employer pastes in, not an automatically-fetched recording
 * or transcription — no new recording/transcription infrastructure is built
 * here. This is a SEPARATE surface from the existing Daily.co webhook
 * `interviews.ai_summary` column (migration 0019, lib/employer-ai.ts
 * `buildInterviewSummaryPrompt`): that one auto-generates on a completed
 * Daily recording with transcription enabled, is never grounded against a
 * scorecard, and is never approved by a human before being stored. The two
 * are intentionally left to coexist rather than merged in this prompt.
 *
 * Anti-fabrication is enforced STRUCTURALLY, not just by prompt instruction:
 * `normalizeInterviewSummary` below verifies every criterion's `quote` is an
 * actual (whitespace-insensitive) substring of the real transcript before
 * trusting it. A model that invents a quote — or simply has none to offer —
 * is forced to "Insufficient evidence" in code, exactly like
 * lib/interview-kits.ts's own anti-fabrication rule for kit generation.
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

export const INSUFFICIENT_EVIDENCE = "Insufficient evidence — the transcript doesn't address this criterion.";

export interface InterviewSummaryCriterion {
  criterion: string;
  assessment: string;
  /** The exact transcript line this judgment is grounded in, or "" when the
   *  transcript doesn't address the criterion (assessment is then always
   *  INSUFFICIENT_EVIDENCE). */
  quote: string;
}

export interface InterviewSummaryContent {
  criteria: InterviewSummaryCriterion[];
}

export interface InterviewSummaryRow extends InterviewSummaryContent {
  interviewId: number;
  employerId: string;
  createdAt: string;
}

/** Whitespace-collapsed, case-insensitive containment check — a model that
 *  reflows a quoted line's whitespace (common LLM behavior) must not be
 *  penalized as "fabricated" for that alone; what matters is that the WORDS
 *  it quotes actually occur, in order, in the real transcript. */
function transcriptContains(transcript: string, quote: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const q = norm(quote);
  if (q.length < 8) return false; // too short to be meaningful evidence (avoids trivial word matches)
  return norm(transcript).includes(q);
}

/** Coerces arbitrary LLM JSON into a safe InterviewSummaryContent, running
 *  the anti-fabrication check against the REAL transcript on every
 *  criterion. Exported so lib/assistant-mutations.ts's artifact builder and
 *  the test suite can both exercise the exact same guard. */
export function normalizeInterviewSummary(raw: unknown, transcript: string, scorecard: string[]): InterviewSummaryContent {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawCriteria = Array.isArray(o.criteria) ? o.criteria : [];
  const byName = new Map<string, { assessment: string; quote: string }>();
  for (const c of rawCriteria) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const name = String(r.criterion || "").trim();
    if (!name) continue;
    byName.set(name.toLowerCase(), { assessment: String(r.assessment || "").trim().slice(0, 500), quote: String(r.quote || "").trim().slice(0, 500) });
  }
  // Always one output row per scorecard criterion, in the kit's own order —
  // a criterion the model skipped entirely is exactly as grounded as one it
  // explicitly punted on, so both land on the same insufficient-evidence row.
  const criteria: InterviewSummaryCriterion[] = scorecard.map((criterion) => {
    const found = byName.get(criterion.trim().toLowerCase());
    if (!found || !found.quote || !transcriptContains(transcript, found.quote)) {
      return { criterion, assessment: INSUFFICIENT_EVIDENCE, quote: "" };
    }
    return { criterion, assessment: found.assessment || INSUFFICIENT_EVIDENCE, quote: found.quote };
  });
  return { criteria };
}

export type InterviewSummaryFailureReason = "not_configured" | "upstream_error" | "unparseable_output";
export type InterviewSummaryResult = { ok: true; summary: InterviewSummaryContent } | { ok: false; reason: InterviewSummaryFailureReason };

const MAX_TRANSCRIPT_CHARS = 40000;

/** One capped LLM call, grounded ONLY in the pasted transcript — scored
 *  against the job's own saved scorecard criteria (never a generic rubric).
 *  `ok: false` on any failure (no API key, upstream error, unparseable
 *  output), logged server-side with context, same convention as
 *  lib/interview-kits.ts `generateInterviewKit`. */
export async function generateInterviewSummary(
  transcript: string,
  kit: Pick<InterviewKitContent, "questions" | "scorecard">,
  logCtx: { employerId: string; interviewId: number },
  ctx: { jobTitle?: string; candidateName?: string } = {}
): Promise<InterviewSummaryResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured" };
  const base = { tool: "summarize_interview", employerId: logCtx.employerId, interviewId: logCtx.interviewId };
  const clipped = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  let text = "";
  try {
    const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
    const anthropic = new AnthropicClient({ apiKey });
    const res = await anthropic.messages.create({
      model: process.env.ASSISTANT_MODEL || "claude-sonnet-4-6",
      max_tokens: 1400,
      system: `You score a job-interview transcript against a fixed scorecard. For EVERY criterion listed, decide whether the transcript gives real evidence for it. If it does, quote the EXACT line (verbatim, word for word) from the transcript that supports your assessment — never paraphrase the quote, never invent one. If the transcript does not address a criterion, say so plainly and leave the quote empty — do NOT guess or invent evidence to fill a gap. Output ONLY valid JSON, no markdown: {"criteria": [{"criterion": string, "assessment": string, "quote": string}]} — one entry per criterion, in the order given.`,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            jobTitle: ctx.jobTitle || "",
            candidateName: ctx.candidateName || "",
            scorecard: kit.scorecard,
            interviewQuestions: kit.questions,
            transcript: clipped,
          }),
        },
      ],
    });
    text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (e) {
    console.error("[interview-summaries] generateInterviewSummary: model call failed", { ...base, error: e instanceof Error ? e.message : e, stack: e instanceof Error ? e.stack : undefined });
    return { ok: false, reason: "upstream_error" };
  }
  if (!text) {
    console.error("[interview-summaries] generateInterviewSummary: model returned no text", base);
    return { ok: false, reason: "upstream_error" };
  }
  const parsed = extractJson<{ criteria?: unknown }>(text);
  if (!parsed) {
    console.error("[interview-summaries] generateInterviewSummary: could not parse model output as JSON", { ...base, rawTextLength: text.length });
    return { ok: false, reason: "unparseable_output" };
  }
  return { ok: true, summary: normalizeInterviewSummary(parsed, clipped, kit.scorecard) };
}

export async function saveInterviewSummary(employerId: string, interviewId: number, summary: InterviewSummaryContent): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !interviewId) return false;
  try {
    const { error } = await c
      .from("interview_summaries")
      .upsert({ interview_id: interviewId, employer_id: employerId, summary, source: "pasted_transcript", created_at: new Date().toISOString() }, { onConflict: "interview_id" });
    return !error;
  } catch {
    return false;
  }
}

export async function getInterviewSummary(employerId: string, interviewId: number): Promise<InterviewSummaryRow | null> {
  const c = db();
  if (!c || !employerId || !interviewId) return null;
  try {
    // List + "take the newest" rather than `.maybeSingle()` — see
    // lib/job-faq-store.ts `getJobFaq`'s comment for why; `interview_id` is
    // the real primary key (upserted on conflict), so there's only ever one
    // row on a real Postgres connection.
    const { data } = await c.from("interview_summaries").select("*").eq("employer_id", employerId).eq("interview_id", interviewId).order("created_at", { ascending: true }).limit(50);
    if (!data || !data.length) return null;
    const row = data[data.length - 1];
    const summary = (row.summary as InterviewSummaryContent) || { criteria: [] };
    return { interviewId: row.interview_id as number, employerId: (row.employer_id as string) || "", criteria: Array.isArray(summary.criteria) ? summary.criteria : [], createdAt: (row.created_at as string) || "" };
  } catch {
    return null;
  }
}
