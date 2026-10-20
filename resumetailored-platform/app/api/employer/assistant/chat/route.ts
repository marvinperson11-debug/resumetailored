import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseAssistant } from "@/lib/employer-plan";
import { resolveUserEmail } from "@/lib/email";
import { runAssistantTurn, type ChatMessage } from "@/lib/assistant-chat";

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

/** POST one assistant chat turn — read-only (Phase 0). Portal tier and above
 *  only; a guest or a Free/sub-Portal employer never reaches the model or any
 *  tool. The reply streams to the client (chunked text) even though the
 *  underlying Claude calls are not token-streamed (see lib/assistant-chat.ts) —
 *  that's purely a transport-layer choice so the panel can render
 *  incrementally. */
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
  const result = await runAssistantTurn({
    employerId: ctx.employerId,
    actorUserId: ctx.userId,
    actorEmail,
    messages,
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
