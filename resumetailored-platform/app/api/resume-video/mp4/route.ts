import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { auth } from "@clerk/nextjs/server";
import { isIndividualPro } from "@/lib/plan";
import { saveVideoGeneration } from "@/lib/video-generations";
import { buildRenderPayload } from "@/lib/resume-video-render";
import { supabaseVideoBackend } from "@/lib/saved-videos-store";
import { cleanSavedMeta, saveVideo, MAX_SAVED_VIDEO_BYTES } from "@/lib/saved-videos";

export const runtime = "nodejs";
// A real Remotion render on the legacy site can take a couple of minutes; keep
// the proxy open long enough to await it (Railway runs Next as a long-lived
// server, so this is a soft hint, not a hard serverless cap).
export const maxDuration = 300;

/**
 * Produce a real, downloadable MP4 for the Resume Video Pro tool.
 *
 * The Next app can't run Remotion/headless Chromium, so this proxies to the
 * legacy site's `/api/resume-video-render` (the working renderer) over a shared
 * secret, exactly like checkout/entitlement do. The legacy endpoint renders the
 * MP4, hosts it under `/videos`, and returns its public URL; we persist a row in
 * `video_generations` and hand the URL back to the browser.
 *
 * PRO ONLY — free users get 403 `pro_required` and the tool routes them to the
 * upgrade flow. The MP3 voiceover flow is untouched; the MP4 is additional.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "resume-video-mp4");
  if (limited) return limited;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });
  }

  if (!(await isIndividualPro())) {
    return NextResponse.json(
      { error: "pro_required", message: "Downloadable MP4 video is a Pro feature." },
      { status: 402 }
    );
  }

  const secret = process.env.ENTITLEMENT_SYNC_SECRET;
  const base = process.env.LEGACY_SITE_URL || "https://resumetailored.com";
  if (!secret) {
    return NextResponse.json({ error: "not_configured", message: "Video rendering is not configured." }, { status: 501 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    script?: string;
    resume?: string;
    style?: string;
    settings?: unknown;
    sceneStarts?: unknown;
    audioUrl?: string;
    title?: string;
    resumeId?: string;
    /** How the video was made (script source, recipient, opener/closer, template) — stored with the saved video. */
    meta?: Record<string, unknown>;
  };

  const script = typeof body.script === "string" ? body.script : "";
  const resume = typeof body.resume === "string" ? body.resume : "";
  if (script.trim().length < 10 && resume.trim().length < 40) {
    return NextResponse.json({ error: "bad_request", message: "Generate a script first." }, { status: 400 });
  }

  try {
    const res = await fetch(`${base}/api/resume-video-render`, {
      method: "POST",
      headers: {
        "x-shared-secret": secret,
        "Content-Type": "application/json",
      },
      // The voiceover (data:audio URL) rides along untouched so the renderer muxes it in as the MP4's audio.
      body: JSON.stringify(buildRenderPayload(body, userId)),
      cache: "no-store",
      // The upstream render is the slow part; give it the same budget as maxDuration.
      signal: AbortSignal.timeout(290000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      videoUrl?: string;
      error?: string;
      message?: string;
    };
    if (!res.ok || !data.success || !data.videoUrl) {
      return NextResponse.json(
        { error: data.error || "render_failed", message: data.message || "The video renderer failed. Please try again." },
        { status: 502 }
      );
    }

    // Best-effort persistence (never blocks the response on a DB hiccup).
    let id: number | null = null;
    try {
      id = await saveVideoGeneration(userId, {
        title: body.title || "Resume video",
        script,
        videoUrl: data.videoUrl,
        template: body.style,
      });
    } catch {
      /* best-effort */
    }

    // Keep the render: copy the MP4 (the legacy host prunes its copies) + a script .txt into the user's private
    // storage and add it to their saved videos. Always a NEW entry; best-effort, so a storage problem never
    // costs the user the video they just waited for.
    let savedId: string | null = null;
    try {
      const be = supabaseVideoBackend();
      const meta = cleanSavedMeta({ ...(body.meta || {}), script, resumeText: resume, settings: body.settings });
      if (be && meta) {
        const file = await fetch(data.videoUrl, { cache: "no-store", signal: AbortSignal.timeout(60000) });
        const declared = Number(file.headers.get("content-length") || 0);
        if (file.ok && declared <= MAX_SAVED_VIDEO_BYTES) {
          const saved = await saveVideo(be, userId, meta, new Uint8Array(await file.arrayBuffer()));
          savedId = saved?.id ?? null;
        }
      }
    } catch (e) {
      console.error("[resume-video/mp4] save failed", e instanceof Error ? e.message : e);
    }

    return NextResponse.json({ success: true, videoUrl: data.videoUrl, id, savedId });
  } catch (err) {
    const e = err as { name?: string };
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return NextResponse.json(
        { error: "render_timeout", message: "The video took too long to render. Try a shorter script." },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: "render_unavailable", message: "Could not reach the video renderer. Please try again." },
      { status: 502 }
    );
  }
}
