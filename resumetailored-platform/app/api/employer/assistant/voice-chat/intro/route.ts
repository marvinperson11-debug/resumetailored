import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseVoiceMode } from "@/lib/employer-plan";
import { resolveUserEmail } from "@/lib/email";
import { getOrCreatePersona, markVoiceIntroduced } from "@/lib/assistant-persona";
import { buildOnboardingGreeting, resolveOnboardingAnswer } from "@/lib/assistant-voice";

export const runtime = "nodejs";

/** GET whether this employer's FIRST voice session needs the onboarding
 *  exchange ("Hi, I'm Taylor. Mind if I call you Maria?") — `persona.
 *  voiceIntroduced` gates it so it only ever runs once. Scale tier and up,
 *  same as the rest of Voice Mode. The client calls this once when voice
 *  mode is first turned on for a session; everything after is a normal
 *  POST /api/employer/assistant/voice-chat turn. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (!canUseVoiceMode(ctx.access)) {
    return NextResponse.json({ error: "scale_required", message: "Voice Mode needs the Scale plan." }, { status: 403 });
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
  if (!canUseVoiceMode(ctx.access)) {
    return NextResponse.json({ error: "scale_required", message: "Voice Mode needs the Scale plan." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const proposedName = typeof body.proposedName === "string" ? body.proposedName : "";
  const answer = typeof body.answer === "string" ? body.answer : "";
  if (!proposedName || !answer) return NextResponse.json({ error: "proposedName and answer are required" }, { status: 400 });

  const result = await resolveOnboardingAnswer(ctx.employerId, proposedName, answer);
  return NextResponse.json(result);
}
