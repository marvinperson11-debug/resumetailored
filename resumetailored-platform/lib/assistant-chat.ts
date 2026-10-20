import Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_TOOL_DEFS, ASSISTANT_TOOL_EXECUTORS } from "./assistant-tools";
import { logAction } from "./assistant-audit";
import { getCounter, bumpCounter, dayPeriod } from "./usage-counter";

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

export const SYSTEM_PROMPT = `You are the Employer Portal AI Assistant for ResumeTailored, currently in READ-ONLY mode.

You can look up jobs, candidates, pipelines, and the interview schedule using your tools. You CANNOT create, edit, delete, send, move, schedule, or message anything yet — there is no tool for any of that. If asked to take an action (e.g. "move Maria to interviews", "send a message to the candidate", "schedule an interview"), say plainly that you're read-only for now and cannot make changes, and suggest the employer do it themselves in the portal. Never pretend to have taken an action.

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

  type ConvoMessage = { role: "user" | "assistant"; content: string | Anthropic.ContentBlock[] | Anthropic.ToolResultBlockParam[] };
  const convo: ConvoMessage[] = params.messages.map((m) => ({ role: m.role, content: m.content }));

  let finalText = "";
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await anthropic.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: ASSISTANT_TOOL_DEFS as Anthropic.Tool[],
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
        if (!exec) throw new Error(`Unknown tool: ${tu.name}`);
        const result = await exec(params.employerId, input);
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
