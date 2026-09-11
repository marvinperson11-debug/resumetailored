import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isIndividualPro } from "@/lib/plan";
import { voiceIdForKey, scriptToSpeech } from "@/lib/video-ai";
import { saveVideoGeneration } from "@/lib/video-generations";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Generate an ElevenLabs voiceover (MP3) from the script. PRO ONLY. Uses the
 *  server owner's ELEVENLABS_API_KEY, so it's gated to control credit spend. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  if (!(await isIndividualPro())) {
    return NextResponse.json({ error: "pro_required", message: "AI voiceover is a Pro feature." }, { status: 402 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "not_configured", message: "Voice is not configured (ELEVENLABS_API_KEY)." }, { status: 501 });

  const body = (await req.json().catch(() => ({}))) as { script?: string; voice?: string; template?: string; title?: string };
  const text = scriptToSpeech(body.script || "").trim();
  if (text.length < 10) return NextResponse.json({ error: "Generate or write a script first." }, { status: 400 });
  if (text.length > 2500) return NextResponse.json({ error: "Script is too long for a short video (keep it under ~2,500 characters)." }, { status: 400 });

  const voiceId = voiceIdForKey(body.voice);
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      if (res.status === 401) return NextResponse.json({ error: "Voice service auth failed (check ELEVENLABS_API_KEY)." }, { status: 502 });
      return NextResponse.json({ error: `Voice generation failed (HTTP ${res.status}).` }, { status: 502 });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const audio = `data:audio/mpeg;base64,${buf.toString("base64")}`;
    await saveVideoGeneration(userId, { title: body.title || "Resume video", script: body.script, template: body.template });
    return NextResponse.json({ audio });
  } catch (err) {
    const e = err as { name?: string };
    if (e?.name === "TimeoutError" || e?.name === "AbortError") return NextResponse.json({ error: "Voice generation timed out. Try a shorter script." }, { status: 504 });
    return NextResponse.json({ error: "Voice generation failed. Please try again." }, { status: 502 });
  }
}
