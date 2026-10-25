import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseReplyAddress, isValidReplyToken } from "./assistant-reschedule";
import { parseQaReplyAddress, isValidQaReplyToken } from "./assistant-qa-reply";
import { processInboundCandidateQuestion, type QaOutcome } from "./assistant-qa";
import { getInterviewForToken, setInterviewCandidateOptout } from "./employer-collab-store";
import { getApplicant, setApplicantCommsOptout } from "./employer-store";
import { createPendingAction } from "./assistant-pending";
import { buildRescheduleInterviewArtifact } from "./assistant-mutations";
import { logActivityForEmployer } from "./notifications-store";
import { logAction } from "./assistant-audit";
import { getEmployerTimezone, formatEmployerTime, wallClockToUtc, DEFAULT_EMPLOYER_TIMEZONE } from "./employer-time";

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

/** A proposed time from the model is a WALL-CLOCK local date-time with no
 *  offset (e.g. "2026-11-07T14:00:00") — converted here via `wallClockToUtc`
 *  under `employerTimezone`. This is the fix for "EDT parsed as UTC-5": the
 *  old prompt asked the model to produce an absolute offset-aware ISO string
 *  itself ("assume the same timezone offset as the interview's current
 *  scheduled time"), which is exactly the kind of arithmetic an LLM gets
 *  wrong under DST. If the model ignores the instruction and returns an
 *  already offset-aware string anyway (has "Z" or "+hh:mm"/"-hh:mm"), that's
 *  trusted as an absolute instant rather than re-interpreted as local — never
 *  double-converted. Returns null for anything unparseable either way. */
function resolveProposedTimeToUtc(raw: string, employerTimezone: string): string | null {
  const trimmed = raw.trim();
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const t = new Date(trimmed).getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  try {
    return wallClockToUtc(trimmed, employerTimezone);
  } catch {
    return null;
  }
}

/** One capped LLM call to classify a candidate's plain-email reply. Strict
 *  JSON out, a hard timeout, and ANY failure (bad JSON, timeout, no API key,
 *  upstream error) resolves to "unknown" with no proposed times — never
 *  throws, so a flaky model call degrades to the safe "ask the employer to
 *  handle it manually" path rather than ever silently fabricating a time.
 *
 *  `employerTimezone` ("Eastern" or no tz named by the candidate -> this is
 *  what "Friday at 2pm" means) is given to the model as the frame for its
 *  wall-clock answer; see `resolveProposedTimeToUtc` for how that answer
 *  becomes a real UTC instant. */
export async function classifyReplyIntent(
  replyText: string,
  currentScheduledAtIso: string,
  nowIso: string = new Date().toISOString(),
  employerTimezone: string = DEFAULT_EMPLOYER_TIMEZONE
): Promise<ClassifiedReply> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { intent: "unknown", proposedTimes: [] };
  try {
    const anthropic = new Anthropic({ apiKey });
    const res = await withTimeout(
      anthropic.messages.create({
        model: ASSISTANT_INBOUND_MODEL,
        max_tokens: 400,
        system: `You classify a candidate's email reply to a job-interview reminder. Right now, in the employer's own timezone (${employerTimezone}), it is ${formatEmployerTime(nowIso, employerTimezone)}. The interview is currently scheduled for ${formatEmployerTime(currentScheduledAtIso, employerTimezone)} (${employerTimezone}).
Respond with STRICT JSON ONLY, no other text, matching exactly: {"intent":"reschedule"|"stop"|"unknown","proposed_times":["..."]}
- intent="reschedule" ONLY if the candidate is asking to change the interview time AND proposes at least one specific time. Resolve any relative date/time ("Friday", "next week", "2pm") into a WALL-CLOCK local date-time in the employer's own timezone (${employerTimezone}) — format "YYYY-MM-DDTHH:MM:SS", with NO "Z" and NO offset — and put each in proposed_times. If the candidate names a different timezone explicitly (e.g. "2pm Eastern", "5pm my time, I'm in Denver"), convert their stated time into the employer's timezone (${employerTimezone}) before writing it: every value in proposed_times must be a wall-clock time AS IT WOULD READ ON A CLOCK in ${employerTimezone}, not in whatever zone the candidate mentioned. If the candidate names no timezone at all, assume they mean ${employerTimezone} (the employer's).
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
    const rawTimes = Array.isArray(parsed.proposed_times) ? parsed.proposed_times.filter((t): t is string => typeof t === "string" && t.trim().length > 0) : [];
    const proposedTimes = rawTimes.map((t) => resolveProposedTimeToUtc(t, employerTimezone)).filter((t): t is string => t !== null);
    // A "reschedule" with nothing parseable is the same as "unknown" to every
    // downstream caller (hard requirement: unparseable -> notify, zero actions).
    if (intent === "reschedule" && !proposedTimes.length) return { intent: "unknown", proposedTimes: [] };
    return { intent, proposedTimes: intent === "reschedule" ? proposedTimes : [] };
  } catch {
    return { intent: "unknown", proposedTimes: [] };
  }
}

export type InboundOutcome = "duplicate" | "invalid_token" | "reschedule_pending" | "stop" | "unknown" | "bad_payload" | "error" | QaOutcome;

export interface ProcessInboundResult {
  outcome: InboundOutcome;
  pendingActionId?: string;
}

/** Which column identifies a claimed row — the original provider-agnostic
 *  path (migration 0056) vs. the Resend-specific path (migration 0058,
 *  lib/assistant-resend-inbound.ts). Both are the SAME idempotency shape,
 *  just on different columns, so a row from either path is still exactly
 *  one row — see `claimInboundEventKey`. */
export interface InboundDedupeKey {
  column: "provider_message_id" | "resend_email_id";
  value: string;
}

export type InboundClaimOutcome = "claimed" | "duplicate" | "error";

/** A genuine unique-index violation (Postgres code 23505, or the message
 *  Postgres/PostgREST uses for one) IS a duplicate — the relevant UNIQUE
 *  index (migration 0056 / 0058) is the real safety net against a race
 *  between two truly-concurrent deliveries for the same key. ANY OTHER
 *  insert error (permission denied, connection dropped, an unrelated
 *  constraint, …) is not evidence of a duplicate and must never be reported
 *  as one — an error must never be readable as a successful dedupe. */
function isUniqueViolationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === "23505") return true;
  return typeof e.message === "string" && /duplicate key|unique constraint/i.test(e.message);
}

/** Idempotency claim keyed on `key.column`: a check-then-insert. Distinguishes
 *  three outcomes rather than collapsing "lost the race" and "something went
 *  wrong" into the same boolean (the bug this fixes): "claimed" (this call
 *  owns processing this delivery), "duplicate" (a genuine unique-constraint
 *  violation, or the row was already there — safe to answer 200 and do
 *  nothing more), and "error" (the select/insert itself failed for some OTHER
 *  reason, or threw) — callers must surface that as a real failure (the
 *  webhook route answers 500), never silently treat it as "already handled".
 *  The real error is always logged here so it's visible even though the
 *  caller only sees the classification. */
async function claimInboundEventKey(key: InboundDedupeKey): Promise<{ outcome: InboundClaimOutcome; error?: unknown }> {
  const c = db();
  if (!c || !key.value) return { outcome: "claimed" }; // unconfigured store: best-effort, never block processing
  try {
    const { data: existing, error: selectError } = await c.from("assistant_inbound_events").select(key.column).eq(key.column, key.value).maybeSingle();
    if (selectError) {
      console.error("[assistant-inbound] claim select failed", { column: key.column, error: selectError });
      return { outcome: "error", error: selectError };
    }
    if (existing) return { outcome: "duplicate" };
    const { error } =
      key.column === "resend_email_id"
        ? await c.from("assistant_inbound_events").insert({ resend_email_id: key.value })
        : await c.from("assistant_inbound_events").insert({ provider_message_id: key.value });
    if (!error) return { outcome: "claimed" };
    if (isUniqueViolationError(error)) return { outcome: "duplicate" };
    console.error("[assistant-inbound] claim insert failed", { column: key.column, error });
    return { outcome: "error", error };
  } catch (e) {
    console.error("[assistant-inbound] claim threw", { column: key.column, error: e });
    return { outcome: "error", error: e };
  }
}

/** Pre-claim a Resend delivery by `email_id` BEFORE fetching the full
 *  message body (lib/assistant-resend-inbound.ts `fetchResendReceivedEmail`)
 *  — a retried delivery is recognized as a duplicate without ever spending a
 *  Resend API call or an LLM classification call on it. Exported for
 *  app/api/webhooks/inbound-email/route.ts; `processInboundReschedule` is
 *  then called with `{ claimed: true }` so it doesn't try to claim the same
 *  key again (which would otherwise see its own just-inserted row and
 *  report a false duplicate). Returns "error" (never "duplicate") when the
 *  claim itself failed for a reason other than a genuine unique violation —
 *  the route answers 500 for that, not 200. */
export async function claimResendDelivery(emailId: string): Promise<InboundClaimOutcome> {
  const r = await claimInboundEventKey({ column: "resend_email_id", value: emailId });
  return r.outcome;
}

/** Records a fetch failure (Resend API unreachable, non-2xx, or an
 *  unparseable response) against an already-claimed Resend delivery. There
 *  is no message content to classify or quote, so this is the same
 *  "unknown" outcome as an unparseable reply, minus the employer
 *  notification (there is nothing real to quote them). */
export async function recordResendFetchFailure(emailId: string): Promise<void> {
  await recordInboundOutcomeKey({ column: "resend_email_id", value: emailId }, null, "unknown");
}

async function recordInboundOutcomeKey(key: InboundDedupeKey, interviewId: number | null, outcome: InboundOutcome, pendingActionId?: string): Promise<void> {
  const c = db();
  if (!c || !key.value) return;
  try {
    await c
      .from("assistant_inbound_events")
      .update({ interview_id: interviewId, outcome, pending_action_id: pendingActionId ?? null })
      .eq(key.column, key.value);
  } catch {
    /* best-effort */
  }
}

/** Process one inbound email reply end to end. Idempotent (see
 *  `claimInboundEventKey`), and every branch is best-effort beyond the one
 *  thing each branch must guarantee: a reschedule creates exactly one
 *  pending action, a stop sets exactly one optout flag, anything else
 *  creates zero pending actions and notifies the employer with the raw text
 *  quoted.
 *
 *  `dedupeKeyOverride` lets the Resend adapter (lib/assistant-resend-inbound.ts)
 *  claim idempotency on `resend_email_id` instead of `payload.providerMessageId`
 *  — everything else about this function is unchanged for that caller. The
 *  original provider-agnostic route (app/api/webhooks/inbound-email/route.ts's
 *  legacy shared-secret path) never passes it, so its behavior is identical
 *  to before this parameter existed.
 *
 *  `opts.claimed` tells this function the caller already won the idempotency
 *  claim for `dedupeKeyOverride` itself (the Resend path pre-claims via
 *  `claimResendDelivery` BEFORE fetching the message body, to avoid spending
 *  a Resend API call + an LLM classification call on a delivery it's about
 *  to recognize as a duplicate anyway) — without it, this function would try
 *  to claim the same key a second time, see its own just-inserted row, and
 *  report a false duplicate on every legitimate first-time Resend delivery. */
export async function processInboundReschedule(
  payload: InboundEmailPayload,
  dedupeKeyOverride?: InboundDedupeKey,
  opts: { claimed?: boolean } = {}
): Promise<ProcessInboundResult> {
  const receivedAtIso = new Date().toISOString();
  const dedupeKey: InboundDedupeKey = dedupeKeyOverride ?? { column: "provider_message_id", value: payload.providerMessageId || "" };
  if (!opts.claimed && dedupeKey.value) {
    const claim = await claimInboundEventKey(dedupeKey);
    if (claim.outcome === "duplicate") return { outcome: "duplicate" };
    if (claim.outcome === "error") return { outcome: "error" };
  }

  const parsed = parseReplyAddress(payload.originalTo);
  if (!parsed) {
    // Not a reschedule-shaped reply-to — try the Candidate Q&A shape
    // (lib/assistant-qa-reply.ts) before giving up as an unknown token. Both
    // shapes share this one dispatcher/one route, per that file's header.
    const qaParsed = parseQaReplyAddress(payload.originalTo);
    if (qaParsed && (await isValidQaReplyToken(qaParsed))) {
      const result = await processInboundCandidateQuestion(qaParsed, payload.text.trim().slice(0, MAX_QUOTE_CHARS), receivedAtIso);
      await recordInboundOutcomeKey(dedupeKey, null, result.outcome);
      return { outcome: result.outcome };
    }
    await recordInboundOutcomeKey(dedupeKey, null, "invalid_token");
    return { outcome: "invalid_token" };
  }
  const interview = await getInterviewForToken(parsed.interviewId);
  if (!interview || !(await isValidReplyToken(parsed, interview.rescheduleTokenHash, interview.scheduledAt))) {
    await recordInboundOutcomeKey(dedupeKey, parsed.interviewId, "invalid_token");
    return { outcome: "invalid_token" };
  }

  const quotedText = payload.text.trim().slice(0, MAX_QUOTE_CHARS);
  const employerTimezone = await getEmployerTimezone(interview.employerId);
  const classified = await classifyReplyIntent(payload.text, interview.scheduledAt, undefined, employerTimezone);

  if (classified.intent === "stop") {
    await setInterviewCandidateOptout(interview.id);
    // Also opts the CANDIDATE out of every other assistant-initiated send
    // (migration 0060) — a "stop" reply means stop contacting them, not just
    // stop reminding them about this one interview.
    await setApplicantCommsOptout(interview.applicantId);
    await logActivityForEmployer(interview.employerId, {
      eventType: "candidate_optout",
      title: "A candidate asked to stop receiving interview emails",
      body: `"${quotedText}"`,
      link: "/employer/collab?tab=interviews",
    });
    await logAction({ employerId: interview.employerId, actorUserId: interview.employerId, action: "candidate_reply_stop", targetType: "interview", targetId: interview.id, payload: { quotedText }, status: "executed" });
    await recordInboundOutcomeKey(dedupeKey, interview.id, "stop");
    return { outcome: "stop" };
  }

  if (classified.intent === "reschedule") {
    const applicant = await getApplicant(interview.employerId, interview.applicantId);
    const candidateName = applicant?.name || "the candidate";
    const { payload: mutPayload, artifact } = await buildRescheduleInterviewArtifact({
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
      await recordInboundOutcomeKey(dedupeKey, interview.id, "unknown");
      return { outcome: "unknown" };
    }
    await recordInboundOutcomeKey(dedupeKey, interview.id, "reschedule_pending", row.id);
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
  await recordInboundOutcomeKey(dedupeKey, interview.id, "unknown");
  return { outcome: "unknown" };
}
