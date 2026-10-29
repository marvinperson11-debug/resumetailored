import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseAssistant, canAssistantMutate } from "@/lib/employer-plan";
import { resolveUserEmail } from "@/lib/email";
import { runAssistantTurn, type ChatMessage } from "@/lib/assistant-chat";
import { runFreeAssistantTurn } from "@/lib/assistant-explainer";
import { isFreeTier } from "@/lib/employer-free-tier";
import { getEmployerTimezone } from "@/lib/employer-time";
import { tryAnswerOwnNameQuery, tryHandleRenameAttempt } from "@/lib/assistant-voice";
import { getOrCreatePersona } from "@/lib/assistant-persona";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MESSAGES = 200; // well above the conversation turn cap; a defensive ceiling, not the cap itself
const MAX_CONTENT_CHARS = 4000;

function cleanMessages(v: unknown): ChatMessage[] {
  if (!Array.isArray(v)) return [];
  const out: ChatMessage[] = [];
  for (const m of v.slice(0, MAX_MESSAGES)) {
    if (!m || typeof m !== "object") continue;
    const role = (m as Record<string, unknown>).role;
    const content = (m as Record<string, unknown>).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const trimmed = content.trim().slice(0, MAX_CONTENT_CHARS);
    if (!trimmed) continue;
    out.push({ role, content: trimmed });
  }
  return out;
}

/** POST one assistant chat turn. Portal tier and above only; a guest or a
 *  Free/sub-Portal employer never reaches the model or any tool. A
 *  Portal-tier employer gets the read-only tools only — Scale and above
 *  (canAssistantMutate) also get the four mutating tools, each of which only
 *  prepares a confirmation card (see lib/assistant-chat.ts, lib/assistant-tools.ts).
 *  The reply streams to the client (chunked text) even though the underlying
 *  Claude calls are not token-streamed (see lib/assistant-chat.ts) — that's
 *  purely a transport-layer choice so the panel can render incrementally. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  const isFree = isFreeTier(ctx.access);
  // Free never 403s here anymore (Section E.1/E.3) — it gets the explainer
  // path below instead of the full read/act assistant.
  if (!isFree && !canUseAssistant(ctx.access)) return NextResponse.json({ error: "portal_required" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const messages = cleanMessages(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }

  const actorEmail = await resolveUserEmail(ctx.userId).catch(() => null);
  const latestUserText = messages[messages.length - 1].content;

  function streamText(text: string): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }

  // Taylor's name is immutable (Combined Build v5, Section A) — a "call you
  // X" / "your name is X" / "rename to X" message never reaches the model;
  // it gets the one fixed refusal instead. Same deterministic handling on
  // both this route and voice-chat, so a rename attempt refuses identically
  // whether typed or spoken. No tier gate: refusing is just copy, not a
  // feature, so every tier that can reach the assistant at all gets it.
  const refusal = await tryHandleRenameAttempt(ctx.employerId, ctx.userId, actorEmail, latestUserText);
  if (refusal) return streamText(refusal);

  // "Do you know my name?" / "what's my name?" — answered straight from the
  // persona row, never the model, which has no view of that column.
  const persona = await getOrCreatePersona(ctx.employerId);
  const nameAnswer = tryAnswerOwnNameQuery(latestUserText, persona);
  if (nameAnswer) return streamText(nameAnswer);

  if (isFree) {
    const result = await runFreeAssistantTurn({ employerId: ctx.employerId, actorUserId: ctx.userId, actorEmail, messages });
    if (!result.ok && result.reason === "throttled") {
      return NextResponse.json({ error: result.reply }, { status: 429, headers: result.retryAfterSeconds ? { "retry-after": String(result.retryAfterSeconds) } : undefined });
    }
    return streamText(result.reply);
  }

  const employerTimezone = await getEmployerTimezone(ctx.employerId);
  const result = await runAssistantTurn({
    employerId: ctx.employerId,
    actorUserId: ctx.userId,
    actorEmail,
    messages,
    canMutate: canAssistantMutate(ctx.access),
    referenceNow: Date.now(),
    employerTimezone,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(result.reply));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
