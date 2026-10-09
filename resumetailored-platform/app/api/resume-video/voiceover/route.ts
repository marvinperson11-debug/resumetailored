import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { auth } from "@clerk/nextjs/server";
import { isIndividualPro } from "@/lib/plan";
import { voiceIdForKey, scriptSpeechWithSpans, elevenLabsRequestBody, buildSceneStarts } from "@/lib/video-ai";
import { saveVideoGeneration } from "@/lib/video-generations";
import { getVideoContext } from "@/lib/video-quota-server";
import { isOverLimit, limitReachedBody } from "@/lib/video-quota";
import { notifyOwner, elevenLabsFailureAlert, classifyElevenLabsError, shouldSendFailureAlert } from "@/lib/owner-alert";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Generate an ElevenLabs voiceover (MP3) from the script. PRO ONLY. Uses the
 *  server owner's ELEVENLABS_API_KEY, so it's gated to control credit spend. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "resume-video-voiceover");
  if (limited) return limited;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  if (!(await isIndividualPro())) {
    return NextResponse.json({ error: "pro_required", message: "AI voiceover is a Pro feature." }, { status: 402 });
  }

  // Over the monthly allowance → refuse BEFORE any ElevenLabs credits are spent.
  const ctx = await getVideoContext(userId);
  if (isOverLimit(ctx.quota)) return NextResponse.json(limitReachedBody(ctx.quota), { status: 429 });

  // ElevenLabs failed in a way that is about the account, not this script: log the exact reply (Railway logs had
  // nothing to go on before) and tell the owner once per window. The key is never logged.
  const failed = async (status: number, bodyText: string) => {
    console.error("[resume-video/voiceover] ElevenLabs HTTP", status, bodyText.slice(0, 400));
    const c = classifyElevenLabsError(status, bodyText);
    if (c && shouldSendFailureAlert(c.reason)) {
      const a = elevenLabsFailureAlert({ email: ctx.email, reason: c.reason, status, detail: c.detail });
      void notifyOwner(a.subject, a.html);
    }
    return c;
  };

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error("[resume-video/voiceover] ELEVENLABS_API_KEY is not set");
    if (shouldSendFailureAlert("auth")) {
      const a = elevenLabsFailureAlert({ email: ctx.email, reason: "auth", status: 501, detail: "ELEVENLABS_API_KEY is not set on the platform service." });
      void notifyOwner(a.subject, a.html);
    }
    return NextResponse.json({ error: "not_configured", message: "Voice is not configured (ELEVENLABS_API_KEY)." }, { status: 501 });
  }

  const body = (await req.json().catch(() => ({}))) as { script?: string; voice?: string; template?: string; title?: string };
  const { text: rawText, spans } = scriptSpeechWithSpans(body.script || "");
  const text = rawText.trim();
  if (text.length < 10) return NextResponse.json({ error: "Generate or write a script first." }, { status: 400 });
  if (text.length > 2500) return NextResponse.json({ error: "Script is too long for a short video (keep it under ~2,500 characters)." }, { status: 400 });

  const voiceId = voiceIdForKey(body.voice);
  const reqBody = JSON.stringify(elevenLabsRequestBody(text, process.env.ELEVENLABS_MODEL_ID));
  // trimmed text must be the exact text the spans index into, or the alignment can't be mapped to beats.
  const spansValid = text === rawText;
  const headers = { "xi-api-key": apiKey, "Content-Type": "application/json" };
  try {
    // 1) Voice + character timestamps in one call (same voice id / model / voice settings the samples use).
    //    The timestamps are what the slides are cut to. Any failure here falls through to plain audio.
    let audio: string | null = null;
    let sceneStarts: number[] | null = null;
    let durationSeconds: number | null = null;
    try {
      const tsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
        method: "POST",
        headers,
        body: reqBody,
        signal: AbortSignal.timeout(45000),
      });
      if (tsRes.ok) {
        const j = (await tsRes.json()) as { audio_base64?: string; alignment?: unknown };
        if (j.audio_base64) {
          audio = `data:audio/mpeg;base64,${j.audio_base64}`;
          const built = spansValid ? buildSceneStarts(j.alignment, text, spans) : null;
          if (built) {
            sceneStarts = built.sceneStarts;
            durationSeconds = built.durationSeconds;
          }
        }
      } else {
        const c = await failed(tsRes.status, await tsRes.text().catch(() => ""));
        if (c?.reason === "auth") return NextResponse.json({ error: "Voice service auth failed (check ELEVENLABS_API_KEY)." }, { status: 502 });
        if (c?.reason === "insufficient_credits") return NextResponse.json({ error: "The voice service is temporarily out of credits. Please try again later." }, { status: 502 });
      }
    } catch {
      /* fall through to the plain endpoint */
    }

    // 2) No usable timestamped response → plain audio. The slides then use the fixed timing.
    if (!audio) {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: { ...headers, Accept: "audio/mpeg" },
        body: reqBody,
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) {
        const c = await failed(res.status, await res.text().catch(() => ""));
        if (c?.reason === "auth") return NextResponse.json({ error: "Voice service auth failed (check ELEVENLABS_API_KEY)." }, { status: 502 });
        if (c?.reason === "insufficient_credits") return NextResponse.json({ error: "The voice service is temporarily out of credits. Please try again later." }, { status: 502 });
        return NextResponse.json({ error: `Voice generation failed (HTTP ${res.status}).` }, { status: 502 });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      audio = `data:audio/mpeg;base64,${buf.toString("base64")}`;
    }
    await saveVideoGeneration(userId, { title: body.title || "Resume video", script: body.script, template: body.template });
    // `aligned:false` ⇒ slide timing is the fixed fallback (no timestamps for this voice/model/script).
    return NextResponse.json({ audio, sceneStarts, durationSeconds, aligned: !!sceneStarts });
  } catch (err) {
    const e = err as { name?: string };
    if (e?.name === "TimeoutError" || e?.name === "AbortError") return NextResponse.json({ error: "Voice generation timed out. Try a shorter script." }, { status: 504 });
    return NextResponse.json({ error: "Voice generation failed. Please try again." }, { status: 502 });
  }
}
