import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseVoiceMode } from "@/lib/employer-plan";
import { cleanName, getOrCreatePersona, renameAssistant, setVoiceSettings } from "@/lib/assistant-persona";

export const runtime = "nodejs";

function toResponse(p: Awaited<ReturnType<typeof getOrCreatePersona>>) {
  return {
    assistantName: p.assistantName,
    employerDisplayName: p.employerDisplayName,
    voiceIntroduced: p.voiceIntroduced,
    ttsVoice: p.ttsVoice,
    ttsRate: p.ttsRate,
  };
}

/** GET the Assistant's persona + this account's voice settings — the chat
 *  header's name, and the Settings popover's voice picker/rate, synced
 *  across devices. Voice Mode is Scale tier and up
 *  (lib/employer-plan.ts `canUseVoiceMode`); there is nothing to show below
 *  that tier, so a sub-Scale employer's chat panel never calls this route. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (!canUseVoiceMode(ctx.access)) {
    return NextResponse.json({ error: "scale_required", message: "This needs the Scale plan." }, { status: 403 });
  }
  const persona = await getOrCreatePersona(ctx.employerId);
  return NextResponse.json(toResponse(persona));
}

/** PATCH the Assistant's name (the Settings field form of a rename — the
 *  deterministic chat/voice "call you X" form goes through
 *  lib/assistant-voice.ts instead, never through this route) and/or this
 *  account's voice picker + rate. Every field is optional and independent —
 *  a client can send just `{ ttsRate: 1.2 }` without touching the name. */
export async function PATCH(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (!canUseVoiceMode(ctx.access)) {
    return NextResponse.json({ error: "scale_required", message: "This needs the Scale plan." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof body.assistantName === "string") {
    const name = cleanName(body.assistantName);
    if (!name) return NextResponse.json({ error: "invalid_name", message: "That name doesn't look right." }, { status: 400 });
    await renameAssistant(ctx.employerId, name);
  }

  const voicePatch: { ttsVoice?: string | null; ttsRate?: number | null } = {};
  if (body.ttsVoice === null || typeof body.ttsVoice === "string") voicePatch.ttsVoice = body.ttsVoice;
  if (body.ttsRate === null) voicePatch.ttsRate = null;
  else if (typeof body.ttsRate === "number" && Number.isFinite(body.ttsRate)) {
    voicePatch.ttsRate = Math.min(2, Math.max(0.5, body.ttsRate));
  }
  if (Object.keys(voicePatch).length) await setVoiceSettings(ctx.employerId, voicePatch);

  const persona = await getOrCreatePersona(ctx.employerId);
  return NextResponse.json(toResponse(persona));
}
