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
 *  the test suite can both exercise the exact same guard.
 *
 *  Over-firing guard (Prompt 6 follow-up, live Oct 24 job 21): matching the
 *  model's `criterion` field against the scorecard's own criterion string
 *  used to be LABEL-RIGID — an exact (case/whitespace-insensitive) string
 *  match only. A model that found real, on-point evidence but returned the
 *  criterion under slightly different wording (e.g. paraphrasing
 *  "Organization and time management" rather than echoing it verbatim) had
 *  its whole entry — assessment AND quote — silently discarded to
 *  "insufficient evidence", even though the evidence was real. That's what
 *  happened to "Organization and time management" while four other,
 *  exact-matching criteria scored normally in the same summary.
 *  Fix: exact-name match stays the FIRST try (unchanged for every criterion
 *  that matches today), with a POSITIONAL fallback — scorecard[i] against
 *  the model's i-th entry — used only when a name lookup misses AND the
 *  model returned exactly one entry per scorecard criterion (what the
 *  extraction prompt instructs: "one entry per criterion, in the order
 *  given"). This recovers mislabeled-but-real evidence without guessing:
 *  if the counts don't line up, there is nothing safe to fall back to, and
 *  the criterion is left insufficient exactly as before. The hard
 *  invariant is untouched either way — a recovered entry still must carry
 *  a real, verbatim quote to count (`transcriptContains` below). */
export function normalizeInterviewSummary(raw: unknown, transcript: string, scorecard: string[]): InterviewSummaryContent {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawCriteria = Array.isArray(o.criteria) ? o.criteria : [];
  type Entry = { assessment: string; quote: string };
  const positional: (Entry | null)[] = rawCriteria.map((c) => {
    if (!c || typeof c !== "object") return null;
    const r = c as Record<string, unknown>;
    return { assessment: String(r.assessment || "").trim().slice(0, 500), quote: String(r.quote || "").trim().slice(0, 500) };
  });
  const byName = new Map<string, Entry>();
  rawCriteria.forEach((c, i) => {
    if (!c || typeof c !== "object") return;
    const name = String((c as Record<string, unknown>).criterion || "").trim();
    const entry = positional[i];
    if (name && entry) byName.set(name.toLowerCase(), entry);
  });
  const positionalTrustworthy = rawCriteria.length === scorecard.length;
  // Always one output row per scorecard criterion, in the kit's own order —
  // a criterion the model skipped entirely is exactly as grounded as one it
  // explicitly punted on, so both land on the same insufficient-evidence row.
  const criteria: InterviewSummaryCriterion[] = scorecard.map((criterion, i) => {
    const found = byName.get(criterion.trim().toLowerCase()) || (positionalTrustworthy ? positional[i] || undefined : undefined);
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
      system: `You score a job-interview transcript against a fixed scorecard. For EVERY criterion listed, decide whether the transcript gives real evidence for it — judge by TOPIC AND SUBSTANCE, not by whether the candidate's words echo the criterion's own label: a concrete example, habit, or story told in completely different vocabulary counts exactly as much as evidence that happens to reuse the label's wording. If the transcript gives real evidence, quote the EXACT line (verbatim, word for word) from the transcript that supports your assessment — never paraphrase the quote, never invent one, and never withhold a real quote just because its phrasing differs from the criterion label. If the transcript does not address a criterion at all, say so plainly and leave the quote empty — do NOT guess or invent evidence to fill a gap. Copy each criterion's "criterion" field back EXACTLY as given below, character for character — never reword, shorten, or relabel it. Output ONLY valid JSON, no markdown: {"criteria": [{"criterion": string, "assessment": string, "quote": string}]} — one entry per criterion, in the order given.`,
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
