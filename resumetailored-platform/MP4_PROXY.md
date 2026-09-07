# Resume Video → real downloadable MP4 (proxy to the legacy renderer)

The Resume Video tool now produces a **real, downloadable MP4** in addition to
the MP3 voiceover. Because the Next app can't run Remotion / headless Chromium
(it builds with `next build`, no browser stack), the app **proxies to the legacy
site's existing Remotion renderer** over the shared secret — the same trust
channel checkout & entitlement already use. Nothing about the MP3 voiceover flow
changed; the MP4 is additive.

**Flow:** UI → `POST /api/resume-video/mp4` (Next, Pro-gated) → `POST /api/resume-video-render`
(legacy, secret-gated) → Remotion renders the MP4, hosts it under `/videos/<id>.mp4`,
returns its public URL → the app saves a `video_generations` row and hands the URL back.

`next build` is green.

---

## 1) Legacy site — `server.js`

Two additions. **(a)** serve rendered MP4s statically, and **(b)** the
secret-gated render endpoint.

### (a) Static `/videos` mount (added right after the main `express.static(public)` block)

```js
// Rendered resume-video MP4s (produced by POST /api/resume-video-render for the
// new Clerk app's Resume Video Pro tool) are written here and served publicly so
// the app can hand the user a real downloadable URL. Files are pruned on a TTL
// (see _pruneRenderedVideos) so the directory never grows without bound; the
// dir lives under DATA_DIR so a mounted Volume keeps links alive across deploys.
const renderedVideoDir = path.join(dataDir, 'videos');
if (!fs.existsSync(renderedVideoDir)) fs.mkdirSync(renderedVideoDir, { recursive: true });
app.use('/videos', express.static(renderedVideoDir, {
  setHeaders: (res) => {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'public, max-age=86400');
  },
}));
```

### (b) `POST /api/resume-video-render` (added after `/api/resume-video/file/:jobId`)

```js
// ─── Server-to-server MP4 render for the Clerk app (app.resumetailored.com) ───
// The new Next.js dashboard can't run Remotion/headless Chromium itself (it's
// built with `next build`, no browser stack), so its Resume Video Pro tool
// proxies here to reuse THIS site's working renderer. Guarded by the shared
// ENTITLEMENT_SYNC_SECRET (the same secret the entitlement / app-checkout
// endpoints use) via an `x-shared-secret` header — unset ⇒ 404 (feature off).
// The app has already enforced sign-in + Pro before calling, so this endpoint
// trusts the shared secret rather than re-checking a subscriber email (the app
// passes a Clerk userId, not necessarily a subscriber-table email).
//
// Body: { script, style, photoUrl, audioUrl, title, userId, resume?, name?, voice? }
//   - `script`  the app's spoken script (used as the render source when no
//               `resume` is supplied — falls back to parseResume's tolerant
//               parsing so scenes still populate).
//   - `resume`  optional full résumé text; preferred over `script` because
//               parseResume derives far better name/title/highlights/skills
//               from it (the app sends it so the MP4 matches the resume).
//   - `style`   accent colour: a hex string, or a known style key
//               (professional/creative/minimal/warm) mapped to a hex.
//   - `photoUrl` optional candidate photo (small image data URL).
//   - `audioUrl` optional pre-made voiceover (the app's ElevenLabs MP3, as a
//               data:audio/... URL) — muxed verbatim so the MP4 uses the exact
//               voice the Pro user already generated, spending no extra credit.
//   - `title`   used only to label the saved generation (not shown in-frame).
// Returns { success: true, videoUrl } — a public URL under /videos.

// Accent presets for the app's style keys, so a caller can send either a raw
// hex or a friendly name. Mirrors VIDEO_TEMPLATES accents in the app's video-ai.
const _VIDEO_STYLE_ACCENTS = {
  professional: '#6366F1',
  creative: '#EC4899',
  minimal: '#0EA5E9',
  warm: '#F59E0B',
};
function _resolveVideoAccent(style, accentColor) {
  for (const v of [accentColor, style]) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(t)) return t;
      if (_VIDEO_STYLE_ACCENTS[t.toLowerCase()]) return _VIDEO_STYLE_ACCENTS[t.toLowerCase()];
    }
  }
  return undefined;
}

// Prune rendered MP4s older than the TTL so /videos never grows without bound.
// Best-effort: any error is swallowed (a stuck file just lingers one more cycle).
const RENDERED_VIDEO_TTL_MS = 24 * 60 * 60 * 1000; // 24h — long enough to download/share
function _pruneRenderedVideos() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(renderedVideoDir)) {
      if (!f.endsWith('.mp4')) continue;
      const p = path.join(renderedVideoDir, f);
      try {
        const st = fs.statSync(p);
        if (now - st.mtimeMs > RENDERED_VIDEO_TTL_MS) fs.unlink(p, () => {});
      } catch (_) { /* ignore a file that vanished mid-scan */ }
    }
  } catch (_) { /* dir missing / unreadable — nothing to prune */ }
}

app.post('/api/resume-video-render', async (req, res) => {
  const secret = process.env.ENTITLEMENT_SYNC_SECRET;
  if (!secret) return res.status(404).json({ error: 'not_configured' });
  if (String(req.headers['x-shared-secret'] || '') !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { script, resume, style, accentColor, photoUrl, audioUrl, name } = req.body || {};
  const sourceText = (typeof resume === 'string' && resume.trim().length >= 40) ? resume
    : (typeof script === 'string' ? script : '');
  if (!sourceText || sourceText.trim().length < 10) {
    return res.status(400).json({ error: 'bad_request', message: 'A script or resume is required to render.' });
  }

  if (videoRenderBusy()) {
    return res.status(429).json({ error: 'busy', message: 'A video is already rendering. Please try again in a moment.' });
  }

  let renderModule, parseModule;
  try {
    renderModule = require('./remotion/render');
    parseModule = require('./remotion/parseResume');
  } catch (e) {
    console.error('Remotion not available:', e.message);
    return res.status(501).json({ error: 'render_unavailable', message: 'Video rendering is not available on this server.' });
  }

  const id = uuidv4();
  const outPath = path.join(renderedVideoDir, `${id}.mp4`);
  let tmpAudioPath = null;
  videoRenderStartedAt = Date.now(); // hold the single-render lock for this render
  try {
    const props = parseModule.parseResume(sourceText, {
      accentColor: _resolveVideoAccent(style, accentColor),
    });
    if (typeof name === 'string' && name.trim().length >= 2 && /[A-Za-z]/.test(name)) {
      props.name = name.trim().slice(0, 60);
    }
    if (typeof photoUrl === 'string' &&
        /^data:image\/(png|jpe?g|webp);base64,/i.test(photoUrl) &&
        photoUrl.length < 800000) {
      props.photoUrl = photoUrl;
    }

    // Quiet background music bed (best-effort).
    try {
      const music = require('./remotion/music').backgroundMusic();
      if (music && music.src) props.musicSrc = music.src;
    } catch (_) { /* no music */ }

    // Mux the app's pre-made ElevenLabs MP3 when provided, so the MP4 carries the
    // exact voiceover the Pro user already generated (no extra credit spent).
    // Best-effort: a data URL we can't parse just yields a silent video.
    if (typeof audioUrl === 'string' && /^data:audio\//i.test(audioUrl)) {
      try {
        const b64 = audioUrl.slice(audioUrl.indexOf(',') + 1);
        const buf = Buffer.from(b64, 'base64');
        if (buf.length > 0 && buf.length < 20 * 1024 * 1024) {
          tmpAudioPath = path.join(os.tmpdir(), `resume-video-audio-${id}.mp3`);
          fs.writeFileSync(tmpAudioPath, buf);
          props.audioSrc = audioUrl; // Remotion <Audio> accepts the data URL directly
          const secs = await _probeVideoDurationSeconds(tmpAudioPath);
          if (secs && secs > 0) {
            const { FPS } = require('./remotion/data');
            props.audioDurationInFrames = Math.ceil(secs * FPS);
          }
        }
      } catch (e) {
        console.error('Provided audio unusable, rendering silent:', e.message);
        delete props.audioSrc;
        delete props.audioDurationInFrames;
      }
    }

    try {
      await withTimeout(renderModule.renderResumeVideo(props, outPath), MAX_RENDER_MS, 'Video render');
    } catch (err) {
      // If a render with audio fails, retry once silent so the caller still gets a video.
      if (props.audioSrc) {
        console.error('Render with audio failed, retrying silent:', err?.message || err);
        delete props.audioSrc;
        delete props.audioDurationInFrames;
        await withTimeout(renderModule.renderResumeVideo(props, outPath), MAX_RENDER_MS, 'Video render (silent retry)');
      } else {
        throw err;
      }
    }

    const origin = `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, videoUrl: `${origin}/videos/${id}.mp4` });
  } catch (err) {
    console.error('Resume video render error:', err?.message || err);
    fs.unlink(outPath, () => {});
    res.status(500).json({ error: 'render_failed', message: String(err?.message || err).slice(0, 200) });
  } finally {
    if (tmpAudioPath) fs.unlink(tmpAudioPath, () => {});
    videoRenderStartedAt = 0; // release the single-render lock
    _pruneRenderedVideos();
  }
});
```

**Why it reuses, not rebuilds, Remotion:** it calls the exact same
`renderResumeVideo(props, outPath)` and `parseResume()` the existing
`/api/resume-video` job uses, honours the same one-at-a-time render lock
(`videoRenderBusy` / `videoRenderStartedAt`) and `MAX_RENDER_MS` timeout, and
does the same silent-audio retry. The one new behaviour is muxing a caller-
supplied MP3 (the app's ElevenLabs voiceover) instead of generating narration
server-side — so the MP4's voice is identical to the MP3 the user just heard and
no extra ElevenLabs credit is spent.

---

## 2) App proxy route — `app/api/resume-video/mp4/route.ts` (new file)

```ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { saveVideoGeneration } from "@/lib/video-generations";

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
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });
  }

  if (!(await isPro())) {
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
    photoUrl?: string;
    audioUrl?: string;
    title?: string;
    resumeId?: string;
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
      body: JSON.stringify({
        script,
        resume,
        style: body.style,
        photoUrl: body.photoUrl,
        audioUrl: body.audioUrl,
        title: body.title || "Resume video",
        userId,
      }),
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

    return NextResponse.json({ success: true, videoUrl: data.videoUrl, id });
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
```

Error contract: **401** `not_signed_in`, **402** `pro_required` (→ upgrade flow),
**502** `render_failed` / `render_unavailable` (legacy render failed or
unreachable), **504** `render_timeout`.

> Supporting change: `lib/video-generations.ts` — `saveVideoGeneration()` now
> returns the inserted row id (`Promise<number | null>`) via `.select("id").single()`
> so the route can echo `{ id }`. The existing voiceover route ignores the
> return value, so this is backward-compatible.

---

## 3) UI — `app/candidate/tools/resume-video.tsx` (patch)

Adds `mp4Url` / `mp4Loading` / `mp4Error` (+ `copied`) state, a `handleGenerateMp4()`
handler, a `copyMp4Link()` helper, and a **Full Video (MP4)** section in the
preview column below the voiceover controls.

New imports:

```tsx
import { Video, Sparkles, Play, Pause, Download, Volume2, Lock, Film, Copy, Check, Loader2 } from "lucide-react";
```

State (next to the existing audio state):

```tsx
// Full-video (MP4) render — additional to the MP3 voiceover flow above.
const [mp4Url, setMp4Url] = useState<string | null>(null);
const [mp4Loading, setMp4Loading] = useState(false);
const [mp4Error, setMp4Error] = useState<string | null>(null);
const [copied, setCopied] = useState(false);
```

Handlers (after `downloadAudio()`):

```tsx
// Render a real, downloadable MP4 by proxying to the legacy site's Remotion
// renderer. Pro-only; free users are routed to the upgrade flow. The MP3
// voiceover flow above is untouched — this is additional.
async function handleGenerateMp4() {
  if (!isPro) {
    router.push("/candidate?upgrade=pro");
    return;
  }
  if (!script.trim()) {
    setMp4Error("Generate or write a script first.");
    return;
  }
  setMp4Loading(true);
  setMp4Error(null);
  setMp4Url(null);
  try {
    const res = await fetch("/api/resume-video/mp4", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script,
        resume: resumeText,
        style: tpl.accent, // accent hex — the legacy renderer accepts a hex or a style key
        audioUrl: audio || undefined, // reuse the ElevenLabs MP3 if one was generated
        title: "Resume video",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; videoUrl?: string; error?: string; message?: string };
    if (res.status === 402 || data.error === "pro_required") {
      router.push("/candidate?upgrade=pro");
      return;
    }
    if (!res.ok || !data.success || !data.videoUrl) {
      throw new Error(data.message || data.error || "The video could not be rendered.");
    }
    setMp4Url(data.videoUrl);
  } catch (e) {
    setMp4Error(e instanceof Error ? e.message : "Something went wrong rendering the video.");
  } finally {
    setMp4Loading(false);
  }
}

async function copyMp4Link() {
  if (!mp4Url) return;
  try {
    await navigator.clipboard.writeText(mp4Url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  } catch {
    /* clipboard blocked — the link is still visible in the button */
  }
}
```

The MP4 section (rendered in the preview column, right after the `<audio>` player):

```tsx
{/* Full video (MP4) — real downloadable file, rendered server-side. */}
<div className="rounded-xl border border-white/10 bg-navy/60 p-4">
  <div className="flex items-center gap-2">
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet to-indigo-500">
      <Film className="h-4 w-4 text-white" />
    </span>
    <div>
      <h4 className="text-sm font-semibold text-white">Full Video (MP4)</h4>
      <p className="text-[11px] text-white/50">
        {isPro
          ? "Render a shareable MP4 — your captions, style, and voiceover muxed into one file."
          : "Pro renders a real, downloadable MP4 you can post to LinkedIn, Shorts, or Reels."}
      </p>
    </div>
  </div>

  <button
    type="button"
    onClick={handleGenerateMp4}
    disabled={mp4Loading}
    className={cn(
      "mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-all",
      "bg-gradient-to-r from-violet to-indigo-500 hover:shadow-[0_0_22px_rgba(139,92,246,0.4)]",
      mp4Loading && "cursor-not-allowed opacity-70"
    )}
  >
    {mp4Loading ? (
      <><Loader2 className="h-4 w-4 animate-spin" /> Rendering… (this can take a minute)</>
    ) : isPro ? (
      <><Film className="h-4 w-4" /> {mp4Url ? "Re-render MP4" : "Generate MP4"}</>
    ) : (
      <><Lock className="h-4 w-4" /> Generate MP4</>
    )}
  </button>

  {mp4Error && (
    <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{mp4Error}</p>
  )}

  {mp4Url && (
    <div className="mt-3 space-y-2">
      <video src={mp4Url} controls className="w-full rounded-lg border border-white/10 bg-black" />
      <div className="flex flex-wrap items-center gap-2">
        <a href={mp4Url} download="resume-video.mp4"
           className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/15">
          <Download className="h-4 w-4" /> Download MP4
        </a>
        <button type="button" onClick={copyMp4Link}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/5">
          {copied ? <><Check className="h-4 w-4 text-teal" /> Copied</> : <><Copy className="h-4 w-4" /> Copy Link</>}
        </button>
      </div>
    </div>
  )}
</div>
```

`mp4Url` is reset whenever the script is regenerated or edited (same points that
already reset `audio`), so the preview never shows a stale render.

---

## Deployment checklist

1. **Env vars — on the Next app (Railway `app.resumetailored.com`):**
   - `LEGACY_SITE_URL` = `https://resumetailored.com` (the legacy site's origin; omit to use the default)
   - `ENTITLEMENT_SYNC_SECRET` = the **same** secret already set on the legacy site
   - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — for the `video_generations` row (persistence is best-effort; the MP4 still returns without them)
   - `CLERK_SECRET_KEY` — already set (auth/Pro gate)
2. **Env vars — on the legacy site (Railway):**
   - `ENTITLEMENT_SYNC_SECRET` — must **match** the app's value, or every render request 401s
   - `DATA_DIR=/data` + a mounted Volume at `/data` — recommended so `/data/videos/*.mp4` (and the 24h links) survive deploys; without it, rendered files live in the ephemeral container and vanish on the next deploy/restart
   - Remotion already deploys via the Debian `Dockerfile` (chrome-headless-shell + fonts) — no change needed
3. **DB:** the `video_generations` table already exists (`supabase/migrations/0005_video_generations.sql`). No new migration.
4. **Deploy the legacy site first** (so `/api/resume-video-render` exists before the app calls it), then the app.
5. **Verify:** sign in as a Pro user → Resume Video → pick/paste a resume → **Generate script** → *(optional)* **Generate voiceover** → **Generate MP4** → wait for the render → the `<video>` preview plays, **Download MP4** saves the file, **Copy Link** copies the `/videos/<id>.mp4` URL. As a free user, **Generate MP4** routes to `/candidate?upgrade=pro`.
6. **Sanity checks:** `curl -sS -o /dev/null -w '%{http_code}' https://resumetailored.com/api/resume-video-render -X POST` → `401` (missing/wrong `x-shared-secret`), and `404` if `ENTITLEMENT_SYNC_SECRET` is unset on the legacy site.

---

## One decision worth flagging (my only open question)

**Scene sync when muxing the app's MP3.** When the app passes its ElevenLabs
`audioUrl`, I mux that exact MP3 and stretch the video to the audio's length —
but the on-screen scenes play at their **default pace** rather than being timed
to the narration (the legacy `/api/resume-video` job gets per-segment timing
because it *generates* the narration itself and knows each segment's start/end).
The result is a correct, watchable MP4 with the right voice; the captions just
aren't lip-synced to it.

If you'd rather have **tight scene-to-voice sync**, the alternative is to **not**
send `audioUrl` and instead let the legacy renderer generate the narration from
the resume props (it already returns segment timing and syncs scenes to it). That
costs a second ElevenLabs generation per MP4 (the MP3 the user downloaded + the
one muxed into the MP4) but gives the polished, synced result. Say the word and
I'll flip it — it's a one-line change in the proxy (drop `audioUrl`) plus passing
`voice` through to the legacy render call.
