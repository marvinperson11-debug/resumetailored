# Pro tools — Resume Video & Personal Website (Web Studio)

Both "Coming Soon" placeholders are now working tools. They **open for everyone**
(free users see the full interface); the Pro gate is on the paid *actions*
(voiceover / publish), which route free users to the upgrade flow. Sidebar items
keep their **PRO** pill. `next build` green.

---

## Resume Video  → sidebar "Resume Video"
- Pick a **saved resume** (from My Resumes) or paste text; pick a **style**
  (Professional / Creative / Minimal / Warm) and a **voice**.
- **Generate script** (free) — AI writes a first-person, 4-beat spoken script
  (HOOK / PROOF / STRENGTHS / CLOSE); fully **editable**.
- **Animated preview** in the chosen style with the script as on-screen captions.
- **Preview voice (browser)** — free, uses the device's speech synth.
- **Generate voiceover** (**Pro**) — real **ElevenLabs** MP3 (server owner's
  `ELEVENLABS_API_KEY`, 8 premade voices ported from the old site) → play +
  **Download MP3**. Free users hit the upgrade flow.
- Routes: `/api/resume-video/script`, `/api/resume-video/voiceover` (Pro, saves to
  `video_generations`).

### ⚠️ Important limitation — please decide (this is my main question)
The download is the **voiceover MP3 + an animated on-screen preview**, not a
rendered **MP4** file. A true MP4 (photo + text overlays + voiceover muxed) on
the old site is produced by **Remotion + headless Chromium** in a Debian
Docker image — that stack **cannot run inside this Next.js app** (Railway builds
it with `next build`, no Chromium/Remotion). To ship real downloadable MP4s I'd
do **one** of:
  1. **Proxy to the legacy site's existing `/api/resume-video`** Remotion
     renderer via a shared secret (like checkout/entitlement already do) — reuses
     the working renderer, returns a real MP4. Needs a small shared-secret
     endpoint added on the legacy site.
  2. **Add a dedicated render service** (Remotion/ffmpeg worker) the app calls.
  3. **Client-side capture** (canvas + MediaRecorder) → produces **WebM**, not
     MP4, and is browser-dependent.

**Which do you want?** My recommendation is **(1)** — it reuses the renderer you
already run. Say the word and I'll wire it.

---

## Personal Website (Web Studio)  → sidebar "Personal Website"
- Pick a **template** (Portfolio / Resume / Creative / Minimal) + **color theme**,
  upload a **photo**, and edit name / headline / about / email / location.
- **Generate copy from resume** (free) — AI fills headline, About, and sections.
- Pick which **sections** to show (checkboxes) and edit their items.
- **Live preview** in an iframe (the real generated HTML).
- **Download HTML** (free) — the full standalone page.
- **Publish website** (**Pro**) — renders server-side, stores one site per user,
  and serves it publicly at **`/site/<slug>`**; returns the link (copy / open).
  Free users hit the upgrade flow.
- Custom domain: **not** built (you marked it Phase 4).
- Routes: `/api/personal-website/copy`, `/api/personal-website/publish` (Pro);
  public `GET /site/<slug>`.

---

## Files added
- `lib/video-ai.ts`, `lib/site-templates.ts` — script/voice + site-HTML generators (pure).
- `lib/video-generations.ts`, `lib/site-store.ts` — Supabase persistence.
- `app/api/resume-video/{script,voiceover}/route.ts`
- `app/api/personal-website/{copy,publish}/route.ts`
- `app/site/[slug]/route.ts` — public site page.
- `app/candidate/tools/{resume-video,personal-website}.tsx`
- `supabase/migrations/0005_video_generations.sql`, `0006_personal_sites.sql`

## Files changed
- `app/candidate/components/tool-host.tsx` — render both tools (no more "coming soon").
- `app/candidate/components/tools-context.tsx` — `video`/`studio` now `kind:"tool"` (open for all; gate is on the actions).
- `components/candidate-sidebar.tsx` — the two items open the modals; PRO pill kept.

## Manual steps (Supabase SQL editor)
Run both:
- `supabase/migrations/0005_video_generations.sql`
- `supabase/migrations/0006_personal_sites.sql`
Publishing a website needs 0006; without it, preview + Download HTML still work.
ElevenLabs voiceover needs `ELEVENLABS_API_KEY` (already on Railway).

## Verify after deploy
- **Resume Video:** sidebar → Resume Video → pick/paste resume → Generate script →
  edit → (Pro) Generate voiceover → play + Download MP3.
- **Personal Website:** sidebar → Personal Website → Generate copy → tweak →
  live preview updates → Download HTML; (Pro) Publish → open the `/site/<slug>` link.
