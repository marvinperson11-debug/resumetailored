import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseAssistant, canAssistantMutate, canUseVoiceMode } from "@/lib/employer-plan";
import { resolveUserEmail } from "@/lib/email";
import { runAssistantTurn, type ChatMessage } from "@/lib/assistant-chat";
import { getEmployerTimezone } from "@/lib/employer-time";
import { buildSpokenReply, pendingTitlesCreatedSince, snapshotPendingIds, tryAnswerOwnNameQuery, tryHandleRenameAttempt } from "@/lib/assistant-voice";
import { getOrCreatePersona } from "@/lib/assistant-persona";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MESSAGES = 200;
const MAX_CONTENT_CHARS = 4000;

// Deliberately a local copy of app/api/employer/assistant/chat/route.ts's own
// `cleanMessages` rather than a shared import — this route and the text
// route are independent entry points onto the same `runAssistantTurn`, and
// keeping each route's own request validation local means neither can be
// changed by editing the other (see Constraints: zero changes to the
// existing chat route's behavior beyond the one small rename hook it
// already has).
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

/** POST one Voice Mode turn. Same underlying `runAssistantTurn` as the text
 *  chat route — voice is an I/O modality, not a second pipeline — but
 *  returns real JSON (`{ reply, spoken, ok }`) instead of a streamed plain
 *  text body, because the client needs the `spoken` variant to hand to
 *  speechSynthesis. Scale tier and up only (`canUseVoiceMode`); a
 *  Portal-tier employer's client never renders a mic button in the first
 *  place, and this route re-enforces it server-side. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (!canUseAssistant(ctx.access)) return NextResponse.json({ error: "portal_required" }, { status: 403 });
  if (!canUseVoiceMode(ctx.access)) {
    return NextResponse.json({ error: "scale_required", message: "Voice Mode needs the Scale plan." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const messages = cleanMessages(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }

  const actorEmail = await resolveUserEmail(ctx.userId).catch(() => null);
  const latest = messages[messages.length - 1].content;

  // Taylor's name is immutable (Combined Build v5, Section A) — see
  // app/api/employer/assistant/chat/route.ts for the identical text-side
  // handling of both checks below.
  const refusal = await tryHandleRenameAttempt(ctx.employerId, ctx.userId, actorEmail, latest);
  if (refusal) return NextResponse.json({ reply: refusal, spoken: refusal, ok: true });

  const persona = await getOrCreatePersona(ctx.employerId);
  const nameAnswer = tryAnswerOwnNameQuery(latest, persona);
  if (nameAnswer) return NextResponse.json({ reply: nameAnswer, spoken: nameAnswer, ok: true });

  const employerTimezone = await getEmployerTimezone(ctx.employerId);
  // Snapshot BEFORE the turn so we can tell whether it drafted something
  // new — `runAssistantTurn`'s own return value carries no such record by
  // design (see lib/assistant-voice.ts). This never reads the card's own
  // body, only which ids exist.
  const before = await snapshotPendingIds(ctx.employerId);
  const result = await runAssistantTurn({
    employerId: ctx.employerId,
    actorUserId: ctx.userId,
    actorEmail,
    messages,
    canMutate: canAssistantMutate(ctx.access),
    referenceNow: Date.now(),
    employerTimezone,
  });
  const newPendingTitles = result.ok ? await pendingTitlesCreatedSince(ctx.employerId, before) : [];
  const spoken = buildSpokenReply({ reply: result.reply, newPendingTitles });

  return NextResponse.json({ reply: result.reply, spoken, ok: result.ok });
}
