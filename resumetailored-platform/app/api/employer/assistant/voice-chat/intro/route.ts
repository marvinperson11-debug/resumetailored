import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseAssistant } from "@/lib/employer-plan";
import { resolveUserEmail } from "@/lib/email";
import { getOrCreatePersona, markVoiceIntroduced } from "@/lib/assistant-persona";
import { buildOnboardingGreeting, resolveOnboardingAnswer } from "@/lib/assistant-voice";

export const runtime = "nodejs";

/** GET whether this employer's FIRST assistant session needs the
 *  onboarding exchange ("Hi, I'm Taylor. Mind if I call you Maria?") —
 *  `persona.voiceIntroduced` gates it so it only ever runs once. Despite
 *  the route's (legacy) path under voice-chat, this fires for ANY tier
 *  that can reach the assistant at all (Portal+, `canUseAssistant`) — name
 *  memory (Combined Build v5, Section A) is a chat-and-voice feature, not
 *  Voice-Mode-only; the text chat panel calls this exactly like the voice
 *  one and renders the greeting as a message bubble instead of speaking
 *  it. Everything after is a normal chat/voice-chat turn. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (!canUseAssistant(ctx.access)) {
    return NextResponse.json({ error: "portal_required", message: "The Assistant needs the Portal plan." }, { status: 403 });
  }

  const persona = await getOrCreatePersona(ctx.employerId);
  if (persona.voiceIntroduced) return NextResponse.json({ intro: false });

  const actorEmail = await resolveUserEmail(ctx.userId).catch(() => null);
  let clerkFirstName: string | null = null;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(ctx.userId);
    clerkFirstName = user?.firstName ?? null;
  } catch {
    clerkFirstName = null;
  }

  const greeting = buildOnboardingGreeting(persona.assistantName, clerkFirstName, actorEmail);
  if (!greeting.awaitingConfirmation) {
    // Nothing resolvable to propose — the exchange is already "done".
    await markVoiceIntroduced(ctx.employerId);
  }
  return NextResponse.json({
    intro: true,
    spoken: greeting.spoken,
    awaitingConfirmation: greeting.awaitingConfirmation,
    proposedName: greeting.proposedName,
  });
}

/** POST the employer's spoken/typed answer to the onboarding question.
 *  Deterministic parse only (lib/assistant-persona.ts `parseNameConfirmation`)
 *  — never an LLM call. `handled: false` means the answer didn't parse;
 *  the client should ask again rather than assuming a decline. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (!canUseAssistant(ctx.access)) {
    return NextResponse.json({ error: "portal_required", message: "The Assistant needs the Portal plan." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const proposedName = typeof body.proposedName === "string" ? body.proposedName : "";
  const answer = typeof body.answer === "string" ? body.answer : "";
  if (!proposedName || !answer) return NextResponse.json({ error: "proposedName and answer are required" }, { status: 400 });

  const result = await resolveOnboardingAnswer(ctx.employerId, proposedName, answer);
  return NextResponse.json(result);
}
