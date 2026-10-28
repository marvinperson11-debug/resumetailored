import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseAssistant, canAssistantMutate, canUseVoiceMode } from "@/lib/employer-plan";
import { resolveUserEmail } from "@/lib/email";
import { runAssistantTurn, type ChatMessage } from "@/lib/assistant-chat";
import { getEmployerTimezone } from "@/lib/employer-time";
import { buildRenameConfirmation, tryHandleRenameIntent } from "@/lib/assistant-voice";

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
  if (!canUseAssistant(ctx.access)) return NextResponse.json({ error: "portal_required" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const messages = cleanMessages(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }

  const actorEmail = await resolveUserEmail(ctx.userId).catch(() => null);

  // A deterministic "call you X" / "your name is X" / "rename to X" message
  // (Voice Mode, Prompt 7) renames the Assistant directly and never reaches
  // the model at all — same handling whether the employer typed it here or
  // it arrived as an STT transcript through the voice-chat route, so a
  // rename works identically from either surface. Gated the same as Voice
  // Mode itself (Scale+) so a Portal-tier employer's plain-text chat stays
  // completely unchanged, per the tier split.
  const renamedTo = canUseVoiceMode(ctx.access)
    ? await tryHandleRenameIntent(ctx.employerId, ctx.userId, actorEmail, messages[messages.length - 1].content)
    : null;
  if (renamedTo) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(buildRenameConfirmation(renamedTo)));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
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
