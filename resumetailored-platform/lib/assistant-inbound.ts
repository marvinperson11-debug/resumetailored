import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseReplyAddress, isValidReplyToken } from "./assistant-reschedule";
import { getInterviewForToken, setInterviewCandidateOptout } from "./employer-collab-store";
import { getApplicant } from "./employer-store";
import { createPendingAction } from "./assistant-pending";
import { buildRescheduleInterviewArtifact } from "./assistant-mutations";
import { logActivityForEmployer } from "./notifications-store";
import { logAction } from "./assistant-audit";

/**
 * Inbound-email processing for the reply-by-email reschedule flow (Employer
 * Portal AI Assistant — Prompt 3). Called from
 * app/api/webhooks/inbound-email/route.ts, never from instrumentation.ts, so
 * — unlike lib/interview-reminders.ts / lib/assistant-send-worker.ts — this
 * file is free to import the full lib/assistant-mutations.ts (and so
 * lib/employer-notify.ts) without risking the edge-runtime build failure
 * those two files' own comments document.
 *
 * Provider-agnostic by design (no inbound-email SDK dependency, per the
 * build's standing rule to avoid new deps unless a provider verification SDK
 * is genuinely required): `parseInboundPayload` reads whichever of several
 * common field names a provider's webhook body happens to use, and the route
 * authenticates the delivery with a single shared-secret header
 * (`INBOUND_WEBHOOK_SECRET`) rather than a provider-specific signature
 * scheme.
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

export const ASSISTANT_INBOUND_MODEL = process.env.ASSISTANT_MODEL || "claude-sonnet-4-6";
const CLASSIFY_TIMEOUT_MS = 8000;
const MAX_QUOTE_CHARS = 600;

export interface InboundEmailPayload {
  from: string;
  subject: string;
  text: string;
  originalTo: string;
  providerMessageId: string;
}

function firstString(body: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Provider-agnostic extraction: tries the field names used by the common
 *  inbound-email webhook shapes (SendGrid Inbound Parse, Mailgun routes,
 *  Postmark inbound, a generic `{from,to,subject,text}` body) without
 *  depending on any of their SDKs. Returns null when nothing recognizable is
 *  present — the route answers 400 for that, distinct from an auth failure. */
export function parseInboundPayload(body: unknown): InboundEmailPayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const from = firstString(b, ["from", "From", "sender", "envelope_from"]);
  const originalTo = firstString(b, ["to", "To", "original_to", "originalTo", "envelope_to", "recipient"]);
  const text = firstString(b, ["text", "Text", "text-plain", "stripped-text", "TextBody", "body-plain", "plain"]);
  const subject = firstString(b, ["subject", "Subject"]);
  const providerMessageId = firstString(b, ["message-id", "Message-Id", "messageId", "MessageID", "sg_message_id"]);
  if (!from || !originalTo || !text) return null;
  return { from, subject, text, originalTo, providerMessageId };
}

export type ReplyIntent = "reschedule" | "stop" | "unknown";

export interface ClassifiedReply {
  intent: ReplyIntent;
  proposedTimes: string[];
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** One capped LLM call to classify a candidate's plain-email reply. Strict
 *  JSON out, a hard timeout, and ANY failure (bad JSON, timeout, no API key,
 *  upstream error) resolves to "unknown" with no proposed times — never
 *  throws, so a flaky model call degrades to the safe "ask the employer to
 *  handle it manually" path rather than ever silently fabricating a time. */
export async function classifyReplyIntent(replyText: string, currentScheduledAtIso: string, nowIso: string = new Date().toISOString()): Promise<ClassifiedReply> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { intent: "unknown", proposedTimes: [] };
  try {
    const anthropic = new Anthropic({ apiKey });
    const res = await withTimeout(
      anthropic.messages.create({
        model: ASSISTANT_INBOUND_MODEL,
        max_tokens: 400,
        system: `You classify a candidate's email reply to a job-interview reminder. Today's date/time is ${nowIso}. The interview is currently scheduled for ${currentScheduledAtIso}.
Respond with STRICT JSON ONLY, no other text, matching exactly: {"intent":"reschedule"|"stop"|"unknown","proposed_times":["..."]}
- intent="reschedule" ONLY if the candidate is asking to change the interview time AND proposes at least one specific time. Resolve any relative date/time ("Friday", "next week", "2pm") into an absolute ISO-8601 date-time (assume the same timezone offset as the interview's current scheduled time) and put each in proposed_times.
- intent="stop" ONLY if the candidate is explicitly asking to stop receiving these emails or opting out of further contact.
- intent="unknown" for anything else — including a reschedule request with no parseable specific time. proposed_times must be [] unless intent="reschedule".`,
        messages: [{ role: "user", content: replyText.slice(0, 4000) }],
      }),
      CLASSIFY_TIMEOUT_MS
    );
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const parsed = JSON.parse(text) as { intent?: unknown; proposed_times?: unknown };
    const intent: ReplyIntent = parsed.intent === "reschedule" || parsed.intent === "stop" ? parsed.intent : "unknown";
    const proposedTimes = Array.isArray(parsed.proposed_times) ? parsed.proposed_times.filter((t): t is string => typeof t === "string" && Number.isFinite(new Date(t).getTime())) : [];
    // A "reschedule" with nothing parseable is the same as "unknown" to every
    // downstream caller (hard requirement: unparseable -> notify, zero actions).
    if (intent === "reschedule" && !proposedTimes.length) return { intent: "unknown", proposedTimes: [] };
    return { intent, proposedTimes: intent === "reschedule" ? proposedTimes : [] };
  } catch {
    return { intent: "unknown", proposedTimes: [] };
  }
}

export type InboundOutcome = "duplicate" | "invalid_token" | "reschedule_pending" | "stop" | "unknown" | "bad_payload";

export interface ProcessInboundResult {
  outcome: InboundOutcome;
  pendingActionId?: string;
}

/** Idempotency claim keyed on the provider's own message id (migration
 *  0056): a check-then-insert, with the migration's own UNIQUE index as the
 *  real safety net against a genuine race between two truly-concurrent
 *  deliveries (an insert that loses that race errors, and is treated the
 *  same as "already claimed" — conservative on purpose: a provider retries a
 *  dropped delivery, but a double-processed one would create a second
 *  pending action, which the hard requirement forbids). Returns true only
 *  when THIS call won the claim. */
async function claimInboundEvent(providerMessageId: string): Promise<boolean> {
  const c = db();
  if (!c || !providerMessageId) return true; // unconfigured store: best-effort, never block processing
  try {
    const { data: existing } = await c.from("assistant_inbound_events").select("provider_message_id").eq("provider_message_id", providerMessageId).maybeSingle();
    if (existing) return false;
    const { error } = await c.from("assistant_inbound_events").insert({ provider_message_id: providerMessageId });
    return !error;
  } catch {
    return false;
  }
}

async function recordInboundOutcome(providerMessageId: string, interviewId: number | null, outcome: InboundOutcome, pendingActionId?: string): Promise<void> {
  const c = db();
  if (!c || !providerMessageId) return;
  try {
    await c
      .from("assistant_inbound_events")
      .update({ interview_id: interviewId, outcome, pending_action_id: pendingActionId ?? null })
      .eq("provider_message_id", providerMessageId);
  } catch {
    /* best-effort */
  }
}

/** Process one inbound email reply end to end. Idempotent (see
 *  `claimInboundEvent`), and every branch is best-effort beyond the one thing
 *  each branch must guarantee: a reschedule creates exactly one pending
 *  action, a stop sets exactly one optout flag, anything else creates zero
 *  pending actions and notifies the employer with the raw text quoted. */
export async function processInboundReschedule(payload: InboundEmailPayload): Promise<ProcessInboundResult> {
  const dedupeKey = payload.providerMessageId || "";
  if (dedupeKey && !(await claimInboundEvent(dedupeKey))) {
    return { outcome: "duplicate" };
  }

  const parsed = parseReplyAddress(payload.originalTo);
  if (!parsed) {
    await recordInboundOutcome(dedupeKey, null, "invalid_token");
    return { outcome: "invalid_token" };
  }
  const interview = await getInterviewForToken(parsed.interviewId);
  if (!interview || !(await isValidReplyToken(parsed, interview.rescheduleTokenHash, interview.scheduledAt))) {
    await recordInboundOutcome(dedupeKey, parsed.interviewId, "invalid_token");
    return { outcome: "invalid_token" };
  }

  const quotedText = payload.text.trim().slice(0, MAX_QUOTE_CHARS);
  const classified = await classifyReplyIntent(payload.text, interview.scheduledAt);

  if (classified.intent === "stop") {
    await setInterviewCandidateOptout(interview.id);
    await logActivityForEmployer(interview.employerId, {
      eventType: "candidate_optout",
      title: "A candidate asked to stop receiving interview emails",
      body: `"${quotedText}"`,
      link: "/employer/collab?tab=interviews",
    });
    await logAction({ employerId: interview.employerId, actorUserId: interview.employerId, action: "candidate_reply_stop", targetType: "interview", targetId: interview.id, payload: { quotedText }, status: "executed" });
    await recordInboundOutcome(dedupeKey, interview.id, "stop");
    return { outcome: "stop" };
  }

  if (classified.intent === "reschedule") {
    const applicant = await getApplicant(interview.employerId, interview.applicantId);
    const candidateName = applicant?.name || "the candidate";
    const { payload: mutPayload, artifact } = buildRescheduleInterviewArtifact({
      interviewId: interview.id,
      employerId: interview.employerId,
      candidateName,
      currentScheduledAt: interview.scheduledAt,
      proposedTimes: classified.proposedTimes,
      quotedText,
    });
    const row = await createPendingAction({
      employerId: interview.employerId,
      actorUserId: interview.employerId,
      action: "reschedule_interview",
      payload: mutPayload,
      artifact,
      irreversible: false,
    });
    if (!row) {
      await recordInboundOutcome(dedupeKey, interview.id, "unknown");
      return { outcome: "unknown" };
    }
    await recordInboundOutcome(dedupeKey, interview.id, "reschedule_pending", row.id);
    return { outcome: "reschedule_pending", pendingActionId: row.id };
  }

  // "unknown" — no pending action; the employer sees the raw reply and
  // decides by hand (hard requirement: unparseable -> notification, zero actions).
  await logActivityForEmployer(interview.employerId, {
    eventType: "candidate_reply_unparsed",
    title: `A candidate replied about ${interview.title || "their interview"} — no time parsed`,
    body: `"${quotedText}" — set the new time manually.`,
    link: "/employer/collab?tab=interviews",
  });
  await recordInboundOutcome(dedupeKey, interview.id, "unknown");
  return { outcome: "unknown" };
}
