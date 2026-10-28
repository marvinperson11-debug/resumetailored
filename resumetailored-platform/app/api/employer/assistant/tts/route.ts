import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseAssistant, canUseVoiceMode } from "@/lib/employer-plan";
import { resolveUserEmail } from "@/lib/email";
import { generateAssistantTts, TTS_REQUEST_CHAR_CAP } from "@/lib/assistant-tts";

export const runtime = "nodejs";
export const maxDuration = 30;

/** POST { text, voice? } -> raw MP3 bytes, or a JSON error the client's
 *  speechSynthesis fallback treats as "fall back, invisibly" (lib/
 *  assistant-tts.ts never throws, so every failure here is a deliberate,
 *  typed response, not a 500).
 *
 *  Gated by `canUseVoiceMode` (Scale tier and up) rather than
 *  `canAssistantMutate`: this route produces spoken OUTPUT for Voice Mode,
 *  not one of the four mutating tools, and `canUseVoiceMode` is the
 *  function lib/employer-plan.ts already keeps separate for exactly this
 *  reason ("voice is an I/O modality... a future change decoupling the two
 *  tiers should only have to touch this one line"). Both currently resolve
 *  to the same Scale+ floor, so this changes no actual behavior today. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (!canUseAssistant(ctx.access)) return NextResponse.json({ error: "portal_required" }, { status: 403 });
  if (!canUseVoiceMode(ctx.access)) {
    return NextResponse.json({ error: "scale_required", message: "Voice Mode needs the Scale plan." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voice = typeof body.voice === "string" ? body.voice : "";
  if (!text) return NextResponse.json({ error: "A text field is required." }, { status: 400 });
  if (text.length > TTS_REQUEST_CHAR_CAP) {
    return NextResponse.json({ error: "too_long", message: `Keep spoken replies under ${TTS_REQUEST_CHAR_CAP} characters.` }, { status: 400 });
  }

  const actorEmail = await resolveUserEmail(ctx.userId).catch(() => null);
  const result = await generateAssistantTts({
    employerId: ctx.employerId,
    actorUserId: ctx.userId,
    actorEmail,
    text,
    voiceKey: voice,
  });

  if (!result.ok) {
    const status = result.reason === "cap" ? 402 : result.reason === "not_configured" ? 501 : result.reason === "too_long" ? 400 : 502;
    return NextResponse.json({ error: result.reason, message: result.message }, { status });
  }

  return new Response(new Uint8Array(result.audio), {
    status: 200,
    headers: {
      "content-type": "audio/mpeg",
      "content-length": String(result.audio.length),
      // Private — this is a specific employer's generated reply, not a public asset.
      "cache-control": "private, max-age=86400",
      "x-tts-cache": result.cached ? "hit" : "miss",
    },
  });
}
