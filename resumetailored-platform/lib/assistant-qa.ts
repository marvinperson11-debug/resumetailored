import type Anthropic from "@anthropic-ai/sdk"; // type-only: erased at compile time, never bundled
import { getJob, getApplicant, getApplicantOwner, setApplicantCommsOptout, getEmployerProfile } from "./employer-store";
import { sendMessage } from "./employer-collab-store";
import { getJobFaq, recordFaqAnswer } from "./job-faq-store";
import { buildQAGrounding, composeCandidateAnswer } from "./job-faq";
import { qaReplyTo, type ParsedQaReplyAddress } from "./assistant-qa-reply";
import { logActivityForEmployer } from "./notifications-store";
import { getCounter, bumpCounter, dayPeriod } from "./usage-counter";
import { sendEmail, emailShell, escapeHtml } from "./email";
import { employerSignatureHtml } from "./employer-signature";

/**
 * Candidate Q&A — processing one real inbound candidate email (Prompt 6,
 * Section 1). Dispatched from lib/assistant-inbound.ts `processInboundReschedule`
 * once a `faq-{jobId}-{applicantId}-{token}` reply address verifies
 * (lib/assistant-qa-reply.ts). Three guardrails apply to EVERY branch below,
 * unconditionally:
 *
 *   1. `candidate_comms_optout` is checked FIRST and is absolute — an opted-out
 *      candidate gets silence, not even a "question not covered" notification
 *      email (the employer still sees it in-app, since that's about the
 *      employer's own inbox, not a send to the candidate).
 *   2. Q&A must be `enabled` for this job AND the question must have arrived
 *      AFTER the current `last_enabled_at` (the same enable-clock rule
 *      lib/assistant-ack-worker.ts applies) — a question that arrived while
 *      Q&A was off is never answered once it's turned back on.
 *   3. The per-job daily cap (`ASSISTANT_QA_DAILY_CAP`, default 25) gates every
 *      SEND — once hit, remaining questions for that job that day fall back
 *      to the employer-notification path, same as an uncovered question.
 *
 * Grounding is ONLY the job's own published fields + its approved FAQ
 * (lib/job-faq.ts `buildQAGrounding`) — never free-form knowledge. An uncovered
 * question notifies the employer in-app and sends nothing to the candidate;
 * this intentionally does NOT draft a suggested employer reply (the spec
 * calls that optional) — see the Prompt 6 report.
 */

export type QaOutcome = "answered" | "uncovered" | "capped" | "stop" | "disabled" | "optout" | "unknown" | "error";

export interface QaProcessResult {
  outcome: QaOutcome;
}

function qaDailyCap(): number {
  const v = Number(process.env.ASSISTANT_QA_DAILY_CAP);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 25;
}

const CLASSIFY_TIMEOUT_MS = 8000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

type QaIntent = "stop" | "question" | "other";

/** Classify a reply on a Q&A thread as a stop request, a real question, or
 *  neither (e.g. a bare "thanks!"). ANY failure (no key, timeout, bad JSON)
 *  resolves to "other" — never treated as a question that could be
 *  mis-answered, never treated as a stop that wasn't really asked for. */
async function classifyQaIntent(replyText: string): Promise<QaIntent> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "other";
  try {
    const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
    const anthropic = new AnthropicClient({ apiKey });
    const res = await withTimeout(
      anthropic.messages.create({
        model: process.env.ASSISTANT_MODEL || "claude-sonnet-4-6",
        max_tokens: 200,
        system: `Classify a candidate's email reply on a job-application Q&A thread. Respond with STRICT JSON ONLY: {"intent":"stop"|"question"|"other"}. "stop" ONLY if they're explicitly asking to stop being emailed/contacted. "question" if they're asking something about the job, the application, pay, hours, benefits, timeline, or anything else about the role. "other" for a bare acknowledgment ("thanks", "ok", "got it") or anything that isn't really a question.`,
        messages: [{ role: "user", content: replyText.slice(0, 4000) }],
      }),
      CLASSIFY_TIMEOUT_MS
    );
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const parsed = JSON.parse(text) as { intent?: unknown };
    return parsed.intent === "stop" || parsed.intent === "question" ? parsed.intent : "other";
  } catch {
    return "other";
  }
}

async function notifyEmployerUncovered(employerId: string, candidateName: string, jobTitle: string, question: string, reason: "uncovered" | "capped"): Promise<void> {
  await logActivityForEmployer(employerId, {
    eventType: "candidate_question_uncovered",
    title: reason === "capped" ? `${candidateName} asked a question about ${jobTitle} — today's Q&A limit is reached` : `${candidateName} asked something not covered by the ${jobTitle} post`,
    body: `"${question}" — this wasn't answered automatically. Reply to ${candidateName} directly, or add it to the job's FAQ.`,
    link: "/employer/collab?tab=applicants",
  });
}

async function emailCandidateAnswer(employerId: string, jobId: number, applicantId: number, candidateName: string, answer: string): Promise<void> {
  const applicant = await getApplicant(employerId, applicantId);
  if (!applicant?.email) return;
  const profile = await getEmployerProfile(employerId);
  const replyTo = (await qaReplyTo(jobId, applicantId)) || undefined;
  const signature = await employerSignatureHtml(employerId);
  const firstName = escapeHtml((candidateName || "there").split(" ")[0] || "there");
  await sendEmail({
    to: applicant.email,
    replyTo,
    fromName: profile?.companyName || undefined,
    subject: `Re: your question about ${profile?.companyName || "the role"}`,
    html: emailShell(`<p>Hi ${firstName},</p><p>${escapeHtml(answer).replace(/\n/g, "<br/>")}</p>`, signature),
  }).catch(() => false);
}

/** `receivedAtIso` is when THIS delivery was first seen (captured by the
 *  caller, lib/assistant-inbound.ts, as early as possible — effectively the
 *  webhook's own arrival time) — the enable-clock check below compares
 *  AGAINST THAT, not against the moment this async function happens to
 *  finish running, so a question that arrived before Q&A was (re-)enabled
 *  is never answered just because processing it took a moment. */
export async function processInboundCandidateQuestion(parsed: ParsedQaReplyAddress, questionText: string, receivedAtIso: string = new Date().toISOString()): Promise<QaProcessResult> {
  const owner = await getApplicantOwner(parsed.jobId, parsed.applicantId);
  if (!owner) return { outcome: "error" };
  const { employerId } = owner;

  const applicant = await getApplicant(employerId, parsed.applicantId);
  const job = await getJob(employerId, parsed.jobId);
  if (!applicant || !job) return { outcome: "error" };

  // Guardrail 1 — absolute, checked before anything else.
  if (applicant.candidateCommsOptout) return { outcome: "optout" };

  const faqRow = await getJobFaq(employerId, parsed.jobId);
  // Guardrail 2 — enabled, AND this question was RECEIVED after the current
  // enable clock — same reasoning as lib/assistant-ack-worker.ts's own
  // last_enabled_at gate: a question that arrived during the OFF window is
  // never answered just because it's processed once Q&A is back on.
  if (!faqRow?.enabled || !faqRow.lastEnabledAt || new Date(receivedAtIso).getTime() < new Date(faqRow.lastEnabledAt).getTime()) {
    return { outcome: "disabled" };
  }

  const intent = await classifyQaIntent(questionText);
  if (intent === "stop") {
    await setApplicantCommsOptout(parsed.applicantId);
    await logActivityForEmployer(employerId, {
      eventType: "candidate_optout",
      title: `${applicant.name || "A candidate"} asked to stop receiving emails`,
      body: `"${questionText.trim().slice(0, 600)}"`,
      link: "/employer/collab?tab=applicants",
    });
    return { outcome: "stop" };
  }
  if (intent !== "question") return { outcome: "unknown" };

  // Guardrail 3 — per-job daily cap, before spending the answer-composition call.
  const period = dayPeriod();
  const scopeId = `job:${parsed.jobId}`;
  const used = (await getCounter(scopeId, "qa_answer", period)) ?? 0;
  if (used >= qaDailyCap()) {
    await notifyEmployerUncovered(employerId, applicant.name || "A candidate", job.title, questionText, "capped");
    await recordFaqAnswer({ employerId, jobId: parsed.jobId, applicantId: parsed.applicantId, question: questionText, answer: "", covered: false, groundingSources: [], sent: false });
    return { outcome: "capped" };
  }

  const { grounding, groundingSources } = buildQAGrounding(job, faqRow.faq);

  const composed = await composeCandidateAnswer(grounding, faqRow.faq, questionText, { employerId, jobId: parsed.jobId });
  const covered = composed.ok && composed.result.covered;
  const answer = composed.ok ? composed.result.answer : "";

  await recordFaqAnswer({ employerId, jobId: parsed.jobId, applicantId: parsed.applicantId, question: questionText, answer, covered, groundingSources, sent: covered });

  if (!covered) {
    await notifyEmployerUncovered(employerId, applicant.name || "A candidate", job.title, questionText, "uncovered");
    return { outcome: "uncovered" };
  }

  await bumpCounter(scopeId, "qa_answer", period, 1);
  const message = await sendMessage(employerId, parsed.applicantId, answer, []);
  if (!message) return { outcome: "error" };
  await emailCandidateAnswer(employerId, parsed.jobId, parsed.applicantId, applicant.name || "there", answer);
  return { outcome: "answered" };
}
