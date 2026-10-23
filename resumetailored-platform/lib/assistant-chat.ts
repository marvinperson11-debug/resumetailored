import Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_TOOL_DEFS, ASSISTANT_TOOL_EXECUTORS, READ_ONLY_TOOL_NAMES } from "./assistant-tools";
import { logAction } from "./assistant-audit";
import { getCounter, bumpCounter, dayPeriod } from "./usage-counter";
import { formatEmployerTime, DEFAULT_EMPLOYER_TIMEZONE } from "./employer-time";

/**
 * Employer Portal AI Assistant — Phase 0 read-only chat orchestration.
 *
 * Not streamed at the Claude-call level (the tool-use loop below makes
 * several non-streaming `messages.create` calls, same pattern as every other
 * Claude call in this codebase — see lib/ai.ts, lib/ats-scan.ts). The HTTP
 * route streams the chat route's RESPONSE to the client once this function
 * has the final answer, so the panel still feels like a stream; token-level
 * streaming through a tool-use loop is a separate, larger change and not
 * needed for Phase 0.
 */

export const ASSISTANT_MODEL = process.env.ASSISTANT_MODEL || "claude-sonnet-4-6";
const MAX_TOOL_ITERATIONS = 6;
const DAILY_COUNTER_KIND = "assistant_turn";

export function getAssistantAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

export function maxConversationTurns(): number {
  const v = Number(process.env.ASSISTANT_MAX_CONVERSATION_TURNS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 20;
}

export function maxEmployerDailyTurns(): number {
  const v = Number(process.env.ASSISTANT_MAX_DAILY_TURNS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 50;
}

export const CONVERSATION_CAP_MESSAGE =
  "We've covered a lot in this conversation and I've reached my limit for a single chat. Start a new conversation and I'll be glad to keep helping.";
export const DAILY_CAP_MESSAGE =
  "We've hit today's assistant usage limit for your account — it resets tomorrow. Thanks for your patience!";
const NOT_CONFIGURED_MESSAGE = "The assistant isn't configured yet. Please contact support.";

export const SYSTEM_PROMPT = `You are the Employer Portal AI Assistant for ResumeTailored.

You can look up jobs, candidates, pipelines, and the interview schedule using your read-only tools at any time. get_pipeline_health finds candidates whose stage hasn't moved in a while — use it (alongside get_jobs/summarize_pipeline/get_schedule) whenever the employer asks something like "what needs my attention today", answering only from what those tools actually return. If this employer also gets the daily morning brief by email, that brief uses the exact same staleness check — you're not describing a different feature, just answering the same question on demand.

When your tools include draft_job_post, publish_job, move_candidates, schedule_interviews, message_candidates, set_ack_template, or send_offer, you can also DRAFT actions for the employer to review — posting/drafting a job, publishing an existing job, moving candidates between pipeline stages, scheduling interviews, sending messages to candidates, setting a standing auto-acknowledgment for new applicants, and sending an offer letter for e-signature. Calling one of these NEVER takes effect immediately: it only prepares a confirmation card that the employer must explicitly approve in the UI before anything real happens. Never say you "have done" one of these — say you've prepared it for approval and point the employer to the card. Resolve every ambiguity (which job, which exact candidates, what message) using your read-only tools BEFORE drafting the mutation — never guess silently; the card shows the employer exactly what was resolved. If the employer corrects a card you already drafted earlier in THIS conversation that is still awaiting approval (e.g. supplying the wage range a blocked draft_job_post or publish_job card said was missing), call that same tool again with the earlier call's pending_action_id so it updates that one card instead of opening a second one for the same request. For draft_job_post and publish_job specifically, this is a courtesy, not a requirement for correctness — if the correction arrives in a different conversation and you don't have the earlier pending_action_id, calling the tool again without one still updates the same still-pending card rather than creating a duplicate, so never fabricate or guess at an id you don't actually have.

draft_job_post vs publish_job: draft_job_post always creates a BRAND NEW job posting. publish_job instead acts on a job that ALREADY EXISTS (one already drafted from the portal's job form, or one you already drafted this conversation) — use publish_job whenever the employer refers to an existing job by name or id and asks to publish/post/make it live, and look the job up first (e.g. with get_jobs) if you don't already know its id. Never call draft_job_post a second time to "publish" something that already exists — that creates a duplicate job. Any publish request for an existing job goes through publish_job, full stop: if something required (like a wage range) is missing or invalid, let the card show that — pass what you have and let publish_job's own validation surface the exact problem on the card — rather than interrogating the employer in prose before ever calling the tool.

set_ack_template is different from the others in two ways: (1) once approved it keeps firing on its own for every future matching applicant with no further approval, so only use it when the employer is clearly asking for a STANDING/automatic acknowledgment, not a one-off message; (2) turning one OFF (disable=true) is immediate with no approval card at all, since removing a future send can only make things safer.

reschedule_interview moves an EXISTING scheduled interview to a new time — use it whenever the employer asks to reschedule/move an interview already on the calendar. Never use schedule_interviews for this: that tool always creates a brand-new interview and would leave the original sitting on the calendar as a duplicate. Identify the candidate by candidate_id when you already have it, or candidate_name otherwise. If the tool comes back with resolved=false, that is NOT "no candidate found" — it means the name didn't resolve to exactly one scheduled interview, and the result carries a 'candidates' list of everyone who currently has one scheduled. Read that list back to the employer as options (e.g. "I found two interviews that could match — did you mean Maria Alvarez or Maria Chen?") and call the tool again with candidate_id once they pick. Never tell the employer their candidate "could not be found" as a dead end when options exist to offer instead.

If a mutating tool isn't in your tool list for this conversation, you're read-only for now (that employer's plan doesn't include the acting assistant) — if asked to take an action, decline warmly, say it needs the Scale plan, and suggest upgrading. Never pretend to have taken an action.

Answer ONLY using information returned by your tools. Never invent a candidate's name, a job's status, a score, a date, or any other fact. If a question needs information you have no tool for, say so plainly instead of guessing. When summarizing, cite the real fields from the tool results (actual names, counts, statuses, dates) rather than vague generalities.`;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantTurnParams {
  employerId: string;
  actorUserId: string;
  actorEmail: string | null;
  messages: ChatMessage[];
  /** Whether this employer's plan includes the ACTING assistant (Scale tier
   *  and up — lib/employer-plan.ts `canAssistantMutate`). Defaults to false
   *  (read-only only) so a caller that forgets to pass it degrades to the
   *  safe side rather than accidentally offering mutating tools. */
  canMutate?: boolean;
  /** Epoch ms "now" for this turn — defaults to Date.now(). Given to the
   *  model (formatted in `employerTimezone`) so "what's on my schedule
   *  today" / "this week" resolve against the right absolute date before it
   *  calls get_schedule — previously the model had no date context at all
   *  and had no way to know what "today" meant. */
  referenceNow?: number;
  /** The employer's own timezone (lib/employer-time.ts `getEmployerTimezone`).
   *  Defaults to the process-wide default if the caller omits it. */
  employerTimezone?: string;
}

export type AssistantTurnResult =
  | { ok: true; reply: string }
  | { ok: false; reason: "conversation_cap" | "daily_cap" | "not_configured"; reply: string };

/** Pure: how many user turns are in this conversation so far (including the
 *  newest one the client is about to send) — exported so the cap check is
 *  directly testable without a network call. */
export function countUserTurns(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "user").length;
}

/** Run one assistant turn: cap checks, the tool-use loop (bounded,
 *  non-streaming), per-tool-call audit logging, then the final text answer.
 *  Every tool call this executes is scoped to `employerId` — the same value
 *  the chat route resolves from the signed-in session via employerContext(),
 *  never a service-role bypass of that scoping. */
export async function runAssistantTurn(params: AssistantTurnParams): Promise<AssistantTurnResult> {
  if (countUserTurns(params.messages) > maxConversationTurns()) {
    return { ok: false, reason: "conversation_cap", reply: CONVERSATION_CAP_MESSAGE };
  }

  const usedToday = (await getCounter(params.employerId, DAILY_COUNTER_KIND, dayPeriod())) ?? 0;
  if (usedToday >= maxEmployerDailyTurns()) {
    return { ok: false, reason: "daily_cap", reply: DAILY_CAP_MESSAGE };
  }

  const anthropic = getAssistantAnthropic();
  if (!anthropic) return { ok: false, reason: "not_configured", reply: NOT_CONFIGURED_MESSAGE };

  // A sub-Scale employer is never even OFFERED the mutating tools — the
  // model has no way to call one, which is what makes "decline gracefully,
  // zero rows created" true by construction rather than by the model's own
  // good behavior. Portal and up always get the five read-only tools.
  const canMutate = !!params.canMutate;
  const tools = canMutate ? ASSISTANT_TOOL_DEFS : ASSISTANT_TOOL_DEFS.filter((d) => READ_ONLY_TOOL_NAMES.includes(d.name));
  const allowedToolNames = new Set(tools.map((t) => t.name));

  type ConvoMessage = { role: "user" | "assistant"; content: string | Anthropic.ContentBlock[] | Anthropic.ToolResultBlockParam[] };
  const convo: ConvoMessage[] = params.messages.map((m) => ({ role: m.role, content: m.content }));

  const employerTimezone = params.employerTimezone || DEFAULT_EMPLOYER_TIMEZONE;
  const referenceNow = params.referenceNow ?? Date.now();
  const systemPrompt = `${SYSTEM_PROMPT}

For reference: right now it is ${formatEmployerTime(referenceNow, employerTimezone)} in this employer's own timezone (${employerTimezone}). Resolve "today", "tomorrow", "this week", etc. against this date before calling a tool like get_schedule, and always pass absolute, fully-qualified ISO-8601 date/times (with a "Z" or an explicit offset) to your tools — never a bare date/time with no timezone information. When you tell the employer about any date or time — an interview's scheduledAt, a deadline, anything a tool handed back as a raw ISO/UTC timestamp — state it ONLY in the employer's own timezone shown above, formatted the same way (e.g. "Fri, Oct 24, 2026, 10:00 AM EDT"). Never show the raw UTC/ISO value and never add a parenthetical UTC conversion like "(14:00 UTC)" — the employer only wants their own local time, not a time-zone lesson.`;

  let finalText = "";
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await anthropic.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools: tools as Anthropic.Tool[],
      messages: convo,
    });

    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!toolUses.length) {
      finalText = text;
      break;
    }

    convo.push({ role: "assistant", content: res.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const input = (tu.input && typeof tu.input === "object" ? (tu.input as Record<string, unknown>) : {}) || {};
      const exec = ASSISTANT_TOOL_EXECUTORS[tu.name];
      try {
        // Defense in depth beyond simply not offering the tool def above: a
        // gated-out tool name is treated as unknown even if somehow requested.
        if (!exec || !allowedToolNames.has(tu.name)) throw new Error(`Unknown tool: ${tu.name}`);
        const result = await exec(params.employerId, input, { actorUserId: params.actorUserId, actorEmail: params.actorEmail });
        await logAction({
          employerId: params.employerId,
          actorUserId: params.actorUserId,
          actorEmail: params.actorEmail,
          action: tu.name,
          targetType: result.targetType,
          targetId: result.targetId,
          payload: input,
          status: "executed",
        });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result.data) });
      } catch (e) {
        await logAction({
          employerId: params.employerId,
          actorUserId: params.actorUserId,
          actorEmail: params.actorEmail,
          action: tu.name,
          targetType: null,
          targetId: null,
          payload: input,
          status: "failed",
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify({ error: e instanceof Error ? e.message : "Tool call failed." }),
          is_error: true,
        });
      }
    }
    convo.push({ role: "user", content: toolResults });

    if (i === MAX_TOOL_ITERATIONS - 1) {
      finalText = text || "I gathered some information but couldn't finish putting together an answer — try asking again, maybe in smaller parts.";
    }
  }

  await bumpCounter(params.employerId, DAILY_COUNTER_KIND, dayPeriod(), 1);
  return { ok: true, reply: finalText || "I don't have an answer for that." };
}
