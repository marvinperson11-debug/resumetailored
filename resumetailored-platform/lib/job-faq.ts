import type Anthropic from "@anthropic-ai/sdk"; // type-only: erased at compile time, never bundled
import { extractJson } from "./tools-ai";
import type { JobPosting } from "./employer-ai";
import type { JobFaqPair } from "./job-faq-store";

/**
 * Candidate Q&A — grounding + the two LLM calls (Prompt 6, Section 1; the
 * one-grounding-function fix below is from the Oct 24 job 21 live finding):
 *
 *   - `generateQaSamples`: the SAMPLE-FIRST gate's own artifact content —
 *     three realistic candidate questions the assistant answers strictly
 *     from grounding, for the employer to approve the STYLE and grounding of
 *     before anything can answer a real candidate
 *     (lib/assistant-mutations.ts `buildEnableCandidateQaArtifact`).
 *   - `composeCandidateAnswer`: the real-time answer to one actual candidate
 *     email (lib/assistant-qa.ts `processInboundCandidateQuestion`).
 *
 * Both calls share the exact same grounding rule and the exact same system
 * prompt text (`QA_SYSTEM_PROMPT`) — the sample card is a true preview of
 * what a real answer will look like, never a separately-worded demo.
 * Grounding is ONLY the published job's own fields + the employer's approved
 * FAQ — never the model's general knowledge, never other candidates' data,
 * never anything about candidacy/ranking, never a promise (offer, schedule).
 * A question the grounding doesn't cover comes back `covered: false` rather
 * than guessed at.
 *
 * `buildQAGrounding` is the ONE place that decides whether a job's fields
 * are groundable at all (`isJobPublished`) — both callers above go through
 * it so a sample card can never show a grounded answer the live path would
 * then refuse to give (the inconsistency a draft job, job 21, actually hit).
 */

export interface JobQaGroundingFields {
  title: string;
  location: string;
  salaryMin: number | null;
  salaryMax: number | null;
  benefitsDescription: string;
  description: string;
}

const EMPTY_QA_GROUNDING: JobQaGroundingFields = { title: "", location: "", salaryMin: null, salaryMax: null, benefitsDescription: "", description: "" };

function jobQaGrounding(job: Pick<JobPosting, "title" | "location" | "salaryMin" | "salaryMax" | "benefitsDescription" | "description">): JobQaGroundingFields {
  return {
    title: job.title,
    location: job.location,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    benefitsDescription: job.benefitsDescription,
    description: job.description,
  };
}

/** The single source of truth for "is this job's post itself groundable" —
 *  live, and findable by a candidate, not a draft an employer is still
 *  writing. Every caller that decides whether to ground on job fields
 *  (enablement sample generation, the live inbound answer path, the
 *  enablement gate) uses this exact check, not its own copy of it. */
export function isJobPublished(job: Pick<JobPosting, "status" | "publicListed">): boolean {
  return job.status === "active" && !!job.publicListed;
}

export interface QaGroundingBundle {
  published: boolean;
  grounding: JobQaGroundingFields;
  groundingSources: string[];
}

/** Job fields + FAQ, gated on `isJobPublished` — an unpublished job grounds
 *  on empty fields (never its draft title/pay/description), exactly as the
 *  live inbound path already enforced; the sample-first enable path now
 *  goes through this same function instead of grounding unconditionally. */
export function buildQAGrounding(job: Pick<JobPosting, "title" | "location" | "salaryMin" | "salaryMax" | "benefitsDescription" | "description" | "status" | "publicListed">, faq: JobFaqPair[]): QaGroundingBundle {
  const published = isJobPublished(job);
  return {
    published,
    grounding: published ? jobQaGrounding(job) : EMPTY_QA_GROUNDING,
    groundingSources: [...(published ? ["job_post"] : []), ...(faq.length ? ["faq"] : [])],
  };
}

const QA_SYSTEM_PROMPT = `You answer a job candidate's question about ONE specific job posting, on behalf of the employer. You are given the job's own published fields and the employer's own approved FAQ for this job as the ONLY source of truth — never use outside/general knowledge, never invent a pay figure, hours, benefit, start date, or any other fact not explicitly present in what you're given.

Hard refusals, no matter what is asked: never discuss this candidate's standing, ranking, or chances; never discuss any OTHER candidate; never promise an offer, an interview, a schedule, or any other action — those are the employer's to make, not yours.

If — and only if — the job fields and FAQ given to you actually answer the question, answer it directly, briefly, and only with what's given. Otherwise, output covered:false — never guess, never approximate, never answer partially and call it done.

Output ONLY valid JSON, no markdown: {"covered": boolean, "answer": string} — "answer" is "" when covered is false.`;

function groundingUserContent(grounding: JobQaGroundingFields, faq: JobFaqPair[], question: string): string {
  return JSON.stringify({ job: grounding, faq, question });
}

export type QaComposeFailureReason = "not_configured" | "upstream_error" | "unparseable_output";
export interface QaComposeResult {
  covered: boolean;
  answer: string;
}
export type QaComposeOutcome = { ok: true; result: QaComposeResult } | { ok: false; reason: QaComposeFailureReason };

/** The "per-question" cap this feature's spec calls for: a short, bounded
 *  answer — never an essay a candidate has to parse for the one fact they
 *  asked about. */
const QA_ANSWER_MAX_TOKENS = 300;

/** One capped LLM call answering ONE real candidate question, strictly
 *  grounded. `ok:false` on any failure (no key, upstream error, unparseable
 *  JSON) — the caller treats that exactly like `covered:false` (notify the
 *  employer, send nothing to the candidate), logged server-side with
 *  context, same convention as every other capped call in this feature. */
export async function composeCandidateAnswer(grounding: JobQaGroundingFields, faq: JobFaqPair[], question: string, logCtx: { employerId: string; jobId: number }): Promise<QaComposeOutcome> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured" };
  const base = { tool: "candidate_qa", employerId: logCtx.employerId, jobId: logCtx.jobId };
  let text = "";
  try {
    const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
    const anthropic = new AnthropicClient({ apiKey });
    const res = await anthropic.messages.create({
      model: process.env.ASSISTANT_MODEL || "claude-sonnet-4-6",
      max_tokens: QA_ANSWER_MAX_TOKENS,
      system: QA_SYSTEM_PROMPT,
      messages: [{ role: "user", content: groundingUserContent(grounding, faq, question) }],
    });
    text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (e) {
    console.error("[job-faq] composeCandidateAnswer: model call failed", { ...base, error: e instanceof Error ? e.message : e });
    return { ok: false, reason: "upstream_error" };
  }
  if (!text) {
    console.error("[job-faq] composeCandidateAnswer: model returned no text", base);
    return { ok: false, reason: "upstream_error" };
  }
  const parsed = extractJson<{ covered?: unknown; answer?: unknown }>(text);
  if (!parsed) {
    console.error("[job-faq] composeCandidateAnswer: could not parse model output as JSON", { ...base, rawTextLength: text.length });
    return { ok: false, reason: "unparseable_output" };
  }
  const covered = parsed.covered === true;
  const answer = covered ? String(parsed.answer || "").trim().slice(0, 2000) : "";
  if (covered && !answer) return { ok: true, result: { covered: false, answer: "" } };
  return { ok: true, result: { covered, answer } };
}

export interface QaSample {
  question: string;
  answer: string;
  covered: boolean;
}
export type QaSamplesOutcome = { ok: true; samples: QaSample[] } | { ok: false; reason: QaComposeFailureReason | "insufficient_output" };

/** Three realistic candidate questions, generated AND answered in the same
 *  call, strictly from the same grounding `composeCandidateAnswer` uses —
 *  this is what the sample-first enable card shows the employer BEFORE any
 *  real candidate can ever reach the assistant. */
export async function generateQaSamples(grounding: JobQaGroundingFields, faq: JobFaqPair[], logCtx: { employerId: string; jobId: number }): Promise<QaSamplesOutcome> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured" };
  const base = { tool: "enable_candidate_qa", employerId: logCtx.employerId, jobId: logCtx.jobId };
  let text = "";
  try {
    const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
    const anthropic = new AnthropicClient({ apiKey });
    const res = await anthropic.messages.create({
      model: process.env.ASSISTANT_MODEL || "claude-sonnet-4-6",
      max_tokens: 900,
      system: `${QA_SYSTEM_PROMPT}\n\nFor THIS call only: invent three realistic questions a candidate might actually email about this job, then answer each exactly as you would a real one — strictly from the job fields and FAQ given, "covered":false for any of your three questions the grounding doesn't actually cover (pick at least one question you CAN answer and prefer ones you can, but never force a covered answer that isn't really grounded). Output ONLY valid JSON, no markdown: {"samples":[{"question":string,"covered":boolean,"answer":string}]} — exactly three entries.`,
      messages: [{ role: "user", content: JSON.stringify({ job: grounding, faq }) }],
    });
    text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (e) {
    console.error("[job-faq] generateQaSamples: model call failed", { ...base, error: e instanceof Error ? e.message : e });
    return { ok: false, reason: "upstream_error" };
  }
  if (!text) {
    console.error("[job-faq] generateQaSamples: model returned no text", base);
    return { ok: false, reason: "upstream_error" };
  }
  const parsed = extractJson<{ samples?: unknown }>(text);
  if (!parsed) {
    console.error("[job-faq] generateQaSamples: could not parse model output as JSON", { ...base, rawTextLength: text.length });
    return { ok: false, reason: "unparseable_output" };
  }
  const raw = Array.isArray(parsed.samples) ? parsed.samples : [];
  const samples: QaSample[] = raw
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const r = s as Record<string, unknown>;
      const question = String(r.question || "").trim();
      if (!question) return null;
      const covered = r.covered === true;
      return { question, covered, answer: covered ? String(r.answer || "").trim().slice(0, 2000) : "" };
    })
    .filter((s): s is QaSample => s !== null)
    .slice(0, 3);
  if (samples.length < 3) {
    console.error("[job-faq] generateQaSamples: model output too thin", { ...base, sampleCount: samples.length });
    return { ok: false, reason: "insufficient_output" };
  }
  return { ok: true, samples };
}
