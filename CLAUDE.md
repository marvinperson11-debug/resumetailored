# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

ResumeTailored AI is a SaaS product that uses Claude (claude-sonnet-4-6) to tailor resumes and generate cover letters from job postings. It charges **$19.99/month** (or $129 lifetime) via Stripe. The **free tier is unlimited** — unlimited resume tailoring, cover letters, ATS scans, and LinkedIn optimizations — differentiated from Pro by a small watermark on exports and a limited template set. Tailoring requires a (free) signed-in account.

### Free vs Pro (2026 structure)

| | Free | Pro ($19.99/mo or $129 lifetime) |
|---|---|---|
| Resume tailoring + cover letters | ✅ unlimited (login required, IP rate-limited) | ✅ unlimited |
| ATS scanner, LinkedIn optimizer, LinkedIn import | ✅ | ✅ |
| Templates | 6 basic (3 resume: Classic `r1`, Executive `r5`, Minimal `r17`; 3 cover: Formal `c1`, Bold `c5`, Clean `c17`) | all 104 |
| Export watermark | small footer mark on PDF/DOCX/TXT | ✅ watermark-free |
| Resume video, personal website | ❌ Pro-only | ✅ |

Template gating is enforced **server-side** in `/api/download-docx` by the free-template `(layout + primary color)` signature — see `FREE_TPL_SIGS` / `isFreeTemplateMeta` in `server.js`. The client picker (`OUT_TPLS` in `public/app.html`, `free:true` flags) mirrors it. Keep the two in sync when changing the free set.

## Commands

```bash
npm install       # install dependencies
npm run dev       # run with nodemon (auto-restarts on file changes)
npm start         # run without nodemon (production)
```

No linter is configured. Tests are plain Node scripts under `test/`, each run directly (`node test/site-publish.js`) and each printing `ALL PASS` or a list of failures — run them all with `for f in test/*.js; do node $f; done`. They cover the Website Creator's document model, rendering parity, publishing, inline editing, and the resume write-back.

## Architecture

Everything lives in two places:

- **`server.js`** — the entire backend: Express app, all API routes, Stripe webhooks, Claude API calls, auth, file parsing, and .docx generation.
- **`public/`** — static frontend: `index.html` (landing page), `app.html` (main dashboard SPA), `style.css`, and post-payment pages.
- **`remotion/`** — the only TypeScript/React in the repo: a self-contained [Remotion](https://www.remotion.dev/docs) project that renders a tailored resume into a short MP4 (see "Resume video" below).

There is no build step for the web app. The frontend is plain HTML/CSS/JS with no framework. `app.html` is a single-page app where tabs are shown/hidden via `showTab()` without any routing. Remotion is the one exception — it has its own TSX compositions, compiled on demand by Remotion's own bundler (not by the web app).

## Resume video (Remotion)

A tailored resume can be turned into a short vertical MP4 (1080×1920, ~18s) for sharing on LinkedIn / Shorts / Reels. This is the only React/TypeScript in the codebase.

- **`remotion/`** — the Remotion project:
  - `index.ts` → `registerRoot`; `Root.tsx` declares the single `ResumeVideo` composition (duration derived from highlight count via `calculateMetadata`).
  - `ResumeVideo.tsx` + `scenes/` (`Background`, `Intro`, `Highlights`, `Skills`, `Outro`) — the animated scenes.
  - `data.js` — **CommonJS** single source of truth for default props + scene timing (`sceneFrames`), shared by both the TSX (via webpack CJS interop) and the Node server. `types.ts` holds only the `ResumeVideoProps` type.
  - `parseResume.js` — converts the plain-text tailor output into `ResumeVideoProps` (name, title, summary, top-5 highlights preferring quantified bullets, skills).
  - `render.js` — server-side renderer: `bundle()` once (cached) + `selectComposition()` + `renderMedia()`. Uses Remotion's own **chrome-headless-shell** (downloaded via `ensureBrowser()`, pre-fetched at build in the `Dockerfile`); it does **not** auto-detect a system Chromium, because recent Chromium builds removed the old headless mode Remotion needs ("Old Headless mode has been removed from the Chrome binary"). The build runs on a **Debian `Dockerfile`** (not Nixpacks) because the prebuilt headless shell can't link against Nixpacks' library paths (it failed to launch with "Closed with 127"); the Dockerfile apt-installs the shell's runtime libs + fonts. An explicit `REMOTION_BROWSER_EXECUTABLE`/`CHROME_PATH` overrides, but only point it at a binary that still supports old headless.
  - `narration.js` — voiceover for the MP4. `generateNarrationAsync` tries, in order: **ElevenLabs** (studio-quality, when `ELEVENLABS_API_KEY` is set — uses the `/with-timestamps` endpoint for an mp3 + exact duration), then the local engine **Piper** (natural neural voice; Piper binary via `PIPER_BIN`/PATH/`python3 -m piper` + a voice model resolved from `PIPER_VOICE`/common dirs or best-effort downloaded), then **espeak-ng** (robotic), else silent. **All three engines are gender-aware:** the voice the user picks (ElevenLabs catalog key, or an explicit `voiceGender`) selects a matching local voice too — Piper uses `en_US-ryan-high` (male) / `en_US-lessac-medium` (female) and espeak uses `en-us+m3` / `en-us+f3` — so a male pick is never rendered in the female fallback voice (env-overridable via `PIPER_VOICE_ID_MALE`/`_FEMALE`, `ESPEAK_VOICE_MALE`/`_FEMALE`). **The pipeline is also language-aware:** `parseResume` auto-detects a predominantly-Chinese resume (CJK share > 25%) and sets `props.lang = 'zh'`, which switches the narration connectives + outro presets to Chinese (`data.js`), the on-screen greeting to 您好, and the local voices to Chinese — Piper `zh_CN-huayan-medium` (the one standard zh voice, used for both genders; `PIPER_VOICE_ID_ZH`/`_ZH_MALE` override) and espeak `cmn+m3`/`cmn+f3` (`ESPEAK_VOICE_ZH`/`_ZH_MALE`); ElevenLabs needs no switch (`eleven_multilingual_v2` speaks the Chinese script natively). Chinese section headers (个人简介/工作经历/专业技能/教育背景 …) normalise onto the English section keys in `parseResume`. The script comes from `narrationScript` in `data.js`. The `Dockerfile` installs Piper + the `en_US-lessac-medium` (female), `en_US-ryan-high` (male), and `zh_CN-huayan-medium` (Chinese) voices on Railway (guarded with `|| true`). The composition muxes the audio via `<Audio>` and extends to fit (`audioDurationInFrames`). The `/api/resume-video` route gates ElevenLabs to **subscribers** by default (`ELEVENLABS_FREE_TIER=on` opens it to all); `RESUME_VIDEO_VOICE=off` disables voice. Best-effort throughout: any failure ⇒ silent video, and the route retries silently if an audio render fails.
- **Endpoint**: `POST /api/resume-video` (`server.js`) takes `{ resume, name?, accentColor?, email }`, **Pro-only** — non-subscribers get a `402 pro_only`. It renders one video at a time (`videoRenderInFlight` lock → 429 if busy), streams the MP4, and deletes the temp file. The heavy Remotion packages are `require()`d lazily inside the handler, so the server boots even if they aren't installed (route returns 501).
- **Frontend**: a "🎬 Resume Video" button in `renderPreviewDownloadButtons()` (`app.html`, hidden for cover-letter-only mode) calls `downloadVideo()`.
- **Web preview (no server render)**: `public/preview.html` (served at `/preview`) plays the composition live in the browser via [`@remotion/player`](https://www.remotion.dev/docs/player), loaded from esm.sh with React pinned through an import map — so it works on static hosting (Netlify deploy previews, mobile) with no Chromium. Supports **upload (PDF/DOCX/TXT, parsed client-side)** or paste, plus a voiceover synced to the player: a free **device voice** (Web Speech API, with a voice picker) or a **pro voice via ElevenLabs** (browser-direct — the user pastes their own API key, kept only in `localStorage` and sent only to ElevenLabs; no server key involved). Its scenes/parser/narration **mirror** the TSX + `data.js` in `remotion/` (kept deliberately in sync); the server-rendered MP4 remains the source of truth.
- **Local dev**: `npm run remotion:studio` (live preview/editor) and `npm run remotion:render` (CLI render to `out/`).
- **Deploy**: rendering needs Chrome's runtime libraries + fonts. The `Dockerfile` apt-installs the chrome-headless-shell deps (`libnss3`, `libatk1.0-0`, `libgbm-dev`, `libasound2`, …), `fontconfig`, and `fonts-dejavu-core`, then pre-downloads the shell via `ensureBrowser()`. Rendering is CPU-heavy — keep the one-at-a-time lock.

## Persistent state (SQLite)

All server state is stored in a **SQLite database** (`better-sqlite3`) created in `server.js`. The DB file lives at `${DATA_DIR}/resumetailor.db` (`DATA_DIR` defaults to `./data`). For persistence across Railway deploys, set `DATA_DIR=/data` and mount a Railway Volume at `/data`; otherwise the DB is recreated in the ephemeral container on each deploy. WAL journaling is enabled.

Tables (all created with `CREATE TABLE IF NOT EXISTS` at startup):

| Table | What it tracks |
|---|---|
| `usage_store` | Per-feature usage counts, keyed by `${ip}_${date}_${type}` (`count`). Since the 2026 change, resume/cover/ATS/LinkedIn are unlimited and no longer written here; still used for `translate` (1/day) and `video`. |
| `subscribers` | Active Stripe subscribers (`email` PK, `customer_id`) |
| `users` | User accounts (`email` PK, `username`, bcrypt `password_hash`) |
| `sessions` | Auth tokens (`token` PK → `email`) |
| `reset_tokens` | Password reset tokens (`token` PK, `email`, `expires_at`) |
| `check_ins` | Career check-in data by `email` |
| `forum_posts` / `forum_replies` | Community forum posts and their replies |
| `shared_resumes` | Snapshot resumes behind `/r/:slug` share links (noindex, watermarked footer) |
| `personal_sites` | Pro personal websites at `/site/:name` (`subdomain` PK, indexable, watermark-free). Several rows per user; at most one with `published = 1` |
| `site_aliases` | Forwarding addresses left behind by a rename (`old_sub` PK → `new_sub`), so old links 301 to the current site |

Access is via prepared statements (`db.prepare(...).run/get/all`). Note: several older docs/comments still reference in-memory `Map` objects — that design has been replaced by the SQLite tables above.

## Auth flow

Sessions use UUID tokens stored in the browser's `localStorage` (`rt_token`, `rt_email`, `rt_username`). The server validates tokens via `GET /api/auth/me`. `app.html` forces the auth modal on load if no valid token exists.

Passwords are hashed with **bcrypt** (`bcryptjs`, per-record salt, `BCRYPT_ROUNDS=10`). Legacy accounts created before the migration used static-salt SHA-256 (`rta_salt_2026_` prefix); those hashes are still verified so nobody is locked out, and are transparently re-hashed to bcrypt on the user's next successful login (lazy migration — see `verifyPassword`/`isLegacyHash` in `server.js`). New signups and password resets always write bcrypt.

## Free tier gating

As of the 2026 pricing change, **the free tier is unlimited** for resume tailoring, cover letters, ATS scans, and LinkedIn optimizations — there is no per-day cap on those. Instead:

- **`/api/tailor` requires a signed-in account** (`getSessionEmail(req)` → 401 if absent) and is **IP rate-limited** (`tailorLimiter`, 20/min). An account, not a daily quota, is what guards the Anthropic API budget now.
- **Watermark**: non-subscribers' exports carry a small footer mark (DOCX `Footer` in `buildTemplatedDocxBuffer`, PDF print footer in `downloadPdf`, TXT trailer). Pro exports are clean. Gated by `isSubscriber(email)`.
- **Templates** are gated server-side (`FREE_TPL_SIGS`, see the table above).

The `usage_store` table still exists and is used for the remaining metered feature (`translate`, 1/day free; `video` is Pro-only). Legacy `hasFreeTierLeft`/`consumeFreeTier`/`getUsageKey` helpers remain for those. The `/api/status` endpoint still returns `freeXLeft` fields, but the client shows "Free — Unlimited Tailoring" rather than a remaining count.

## LinkedIn OAuth (free) — login + profile import

Optional feature (`server.js`, routes `/api/auth/linkedin`, `/callback`, `/draft`, `/session`, `/status`). Uses **"Sign In with LinkedIn using OpenID Connect"** (scope `openid profile email`) — official API, no scraping. The OAuth trip carries a `mode` (stored server-side against the CSRF `state`):

- **`mode=login`** — "Continue with LinkedIn" on the auth modal. The callback upserts the account for the LinkedIn email (creating a free, password-less account on first use — `_linkedInUpsertSession`), opens a session, and hands a one-time session token back to the SPA (`?linkedin_login=<handoff>` → `/api/auth/linkedin/session`).
- **`mode=import`** (default) — "Import from LinkedIn" buttons in the resume builder and the LinkedIn Optimizer. The callback returns a one-time profile draft (`?linkedin=<handoff>` → `/api/auth/linkedin/draft`) to prefill the tool that started it (client stashes the target in `localStorage`). Name/email/photo (headline only if the app's granted scopes return it; standard OIDC does not expose full work history / education / skills, so the client scaffolds those and prompts the user to complete them).

Buttons are visible by default and hidden only when `/api/auth/linkedin/status` reports it unconfigured (`LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET` unset); the authorize route redirects back with a friendly `not_configured` message rather than dumping JSON. CSRF `state` and one-time handoffs are held in short-lived in-memory maps.

## Personal portfolio websites (Pro)

Pro users publish a resume as a live public page (`personal_sites` table; `POST/GET/DELETE /api/personal-site`, Pro-gated via `isSubscriber`). Rendered at **`/site/:name`** — indexable and **watermark-free** — by the shared `_shareResumeHtml(row, origin, opts)` renderer (also used by `/r/:slug` share links, which stay noindex and keep the brand footer). Subdomains are validated (3–30 chars, `RESERVED_SUBDOMAINS` blocklist).

**A user may keep several sites** — one per template they have tried — but only **one is ever published**: publishing a site unpublishes the others server-side (both `POST /api/personal-site` with `publish:true` and `PATCH /api/personal-site`). `GET /api/personal-sites` lists them all; `DELETE /api/personal-sites/:sub` removes one by name; `GET /api/personal-sites/:sub/render` returns an owner-only noindex render used for the Back Office thumbnails. Renaming an address leaves a row in `site_aliases`, and the old address 301s to the new one (`_movedTarget`), so links already shared keep working.

The **Back Office** (`public/app.html`, `boRenderSites`) lists every site as a card — live thumbnail, template name, last edited, address, Edit / Publish / Delete — with the Published badge read directly off `published`. "Edit" stashes `wcOpenSub` and lets `showTab('website')` do the single load; passing it as an argument raced the tab's own call.

### Resume sync (Feature C)

Editing a field on the site **detaches** it (`site-fields.js`): the site owns it and later resume updates leave it alone. Carrying such a change back to the saved resume is `POST /api/resume-sync`, backed by **`resume-writeback.js`**.

**The prompt that offered this is not currently wired.** It was part of the deleted simple-mode surface; the route, the write-back module, the in-page offer UI (`showSync` in `_sdEditLayer`) and the Back Office `siteSync` badge all remain, but nothing posts `__rtSync` into the canvas any more, so a user is never asked. Re-enabling it means posting that message after an inline edit and handling `syncAnswer` in the canvas message bridge in `app.html`.

That module is the only code in the product that writes to `saved_resumes`, and its rule is: **if the field cannot be located with certainty, write nothing.** Never a best-effort append — a resume that quietly gains a stray line is worse than a sync that occasionally cannot run. Certainty means the text at the located position is exactly what the site had before the edit; a resume of an unanticipated shape simply fails to match. `writeFields` is all-or-nothing, because the site's `subtitle` is "role · location" and half a write would leave the resume saying something the user never approved.

Fields: `name` (first non-empty line), `location` (contact-line segment, refused if ambiguous), `role` (title prefix of the first EXPERIENCE entry), `summary` (body under SUMMARY/PROFILE/OBJECTIVE/ABOUT). Skills and per-entry experience are **not** editable fields on the site, so there is nothing to sync for them. Declining twice for a field stops the offer permanently (`props.syncNo`); a ten-second timeout is not a decline. `GET /api/resumes` returns `siteSync` (`synced` / `out_of_sync` / `null`) for the Back Office badge — only for the resume the site was built from.

### The editor (one editor, the rail editor)

`cvShell` in `app.html` — dark chrome, left rail, scaled canvas, inspector. There is no second surface: the full-screen "simple mode" view was deleted, and the tests assert the **absence of its source**, not the absence of a route.

- **The canvas** is an iframe rendered through `POST /api/personal-site/preview` with `editable: true`, so it is the same renderer as the published page **plus** the inline editor (`_sdEditLayer` in `server.js`). Typing therefore happens on the real text node in its real typography.
- **Typing.** Press an already-selected text element and release without moving → the parent posts `{action:'beginEdit', el}` into the iframe. For the duration of a session the overlay gives up its pointer events (`#wcEdOverlay.is-typing`) and canvas re-renders are **deferred, not dropped** (rebuilding `srcdoc` destroys the caret). The page answers `editBegan` / `editEnd`; if it never answers, a watchdog takes the pointer events back. Moving the pointer past `ED_TYPE_SLOP` makes it a drag instead.
- **The gear** (`.ed-gear`) floats `#wcEdInspector` beside the element on desktop (clamped into the viewport, repositioned on scroll/resize) and leaves it as a bottom sheet at ≤820px. It is the **same** panel as the docked one — do not build a second.
- **The panel opens on the gear and on nothing else.** `_edGearOpen` is the whole condition in `edRenderInspector`; selecting is silent. Everything that closes it — a press on the canvas, a click outside, a `pageclick` from inside the iframe, selecting something else — goes through `edSetGear(false)`, so "closed" cannot mean two things. Clicking inside the panel or on the gear is exempt.
- **A press on an already-selected element acts on it**, and what that means depends on the type: a caret for text (`edIsText`), the file picker for a photo/video/audio slot (`edMediaType`). Moving past `ED_TYPE_SLOP` first makes it a drag instead.
- **`beginEdit` is held until the canvas says it is ready.** Every edit replaces `srcdoc`, and the inline editor only listens once its script has run (which waits on stylesheets) — a press in that window used to post into a document with no listener and vanish. `_edCanvasReady` / `_edPendingEdit` cover it; the watchdog is the backstop.
- **Overlay chrome is counter-scaled.** The overlay lives inside the scaled wrap, so `edFitStage` publishes the scale as `--edk` and `.ed-chrome` / `.ed-h` divide it out. Anything added to the overlay that a user must hit needs the same treatment, or it will be a few physical pixels on a phone.
- **The canvas is SIZED, not only scaled.** `transform: scale()` changes what is painted and nothing about the layout box, so `#wcEdWrap` stayed 1200px wide however far down it was scaled and `.cv-stage` scrolled sideways to reach the rest — 47px at 1440, 443px at 390. The wrap is `position:absolute` with a `top left` origin and keeps the canvas's own 1200px coordinates (the overlay, the drag maths and the handles are all positioned in them); `.cv-canvasbox` carries the **scaled** width/height, written by `edFitStage`. Anything that changes the scale must write both, and `test/browser/editor.js` proves it by actually scrolling the stage after the phone toggle and after a zoom.
- **File uploads must not use `authHeaders()`.** It declares `application/json`, which overwrites the multipart Content-Type on a `FormData` body — the boundary is lost and `express.json()` 400s the request before the route sees it. Every media upload failed this way until it was caught. Use `authHeadersNoType()`.
- **Preview** (`wcSetView`) is the stage's other view. `wcView` tells `edSetDevice` which one to resize — the toggle used to move only the canvas — and `wcFitPreview` sizes from a MEASURED stage width, because `width:100%` of an auto-width parent falls back to the iframe default of 300px.
- **A mobile preview on a desktop wears a phone chassis** (`.pv-chassis`, toggled by `_pvChassisOn(mobile)` = mobile selected AND `innerWidth > 820`). Both fit functions use the one rule; the bezel is OUTSIDE the scaled frame (or it shrinks with the page) and is subtracted from `avail` BEFORE the scale is computed (or the frame is what makes the preview overflow). `PV_CHASSIS` must match the padding in `.pv-chassis.is-on`.
- **There are TWO previews.** The editor's (`wcSetView('preview')` → `wcFitPreview`) and the template card's (`openTplPreview` → `wcTplDevice`). They had the same dead-toggle bug and were fixed separately; a report about "Preview" needs pinning to one before anything is changed.
- **The picker's gallery is `#cvPanel`, and it is not a drawer.** The document-level "clicking the page retracts the panel" handler counted clicks inside the template modal — a sibling of the shell — as clicks on the page, so touching anything in that modal hid the gallery behind it and Close revealed an empty stage: a blank screen made of correctly-behaving parts. It now exits on `body.wb-picker` and on `_cvInOverlay(target)` (any `position:fixed` ancestor above the shell's z-index 200), so every modal is covered without a list of ids.
- **A preview is of a LAYOUT, not of the room to show it.** `wcFitPreview` lays the page out at the device's own width (390 phone; `max(stage, PV_DESK_MIN=1000)` desktop) and scales it to fit; `#wcPreviewBox` carries the scaled size, the frame keeps the layout width. It used to size the frame `mobile ? Math.min(390, avail) : avail`, and on a phone `avail` is ~334 so both branches gave 334 — both views rendered at phone width and only the highlight moved. The desktop preview must never be laid out under 820px or the site's own phone stylesheet applies to it. `test/browser/editor.js` presses the buttons and measures the page's layout width, at 390px with no exemption.
- **Save** (`wcSaveNow`) writes and stays. `wcDoneEditing` flushes and leaves for the Back Office; that is the app's own navigation, not a button in the bar.
- **Autosave** is subscribed in `edInit` (`wcQueueSave`). It used to live in simple mode's boot, which meant it silently stopped running when that became unreachable — keep it attached to the editor.
- **Adding into a box** (`edAddInto`) places the new element inside the selected element's rect when it fits and directly beneath it when it does not; the document is flat and nothing nests.
- **Every box is its own element.** Templates draw showcase rows with a `gallery` — one element holding many pictures — which reads as several boxes and edits as one. `SiteDocStore.splitAll` runs in `templateDoc()`, so a new site never contains one; `splitElement` is offered in the gear for sites built before that. Split boxes carry `props.phShow`, WITHOUT WHICH they render as empty photo slots and vanish.
- **A video's controls must stay inside its box.** `.sd-el--fit` is a flex COLUMN: the label takes its natural height and the media takes the rest. Both claiming `height:100%` overflowed by the label's height and `overflow:hidden` clipped the bottom — where the native control bar is — so the play button was visible and unpressable.
- **The overlay covers the canvas, so a video cannot be played by clicking it.** The selected element carries its own `.ed-play`, which posts `{action:'playPause', el}` into the iframe. Do not punch a hole in the overlay for media; that costs dragging and resizing on those elements.
- **`<source>` carries a `type`.** Stored on the element at upload (`props.srcType`); for anything older, `_sdMediaType` looks the mime up from `site_media` by id (memoised). `/media/12` and `/media/12.mp4` are the same file.
- **MOV uploads and warns.** `video/quicktime` is accepted but never transcoded — there is no encoder here — so the response carries `safe:false` and a message the client shows.
- **Media is contained, text grows.** `_SD_FIT_TYPES` in `server.js` decides which: those take `height` + `object-fit:cover` + `overflow:hidden`, everything else takes `min-height`. A video without this takes whatever height its aspect ratio wants and hangs outside its element.
- **A photo's height comes from the box, at every width.** `.sd-el--fit` is a two-row **grid** (`auto minmax(0,1fr)`), media pinned to row 2 with `height:100%`. Not a flex column: a `1fr` track resolves from the element's own definite height *before* the media is measured, where flex asks a replaced element (`img`/`video`/`iframe`) to grow from an intrinsic size a video may not have yet. The mobile block must not override media height — it used to carry `.sd-ibox,.sd-img{height:auto!important}`, the one rule that made a phone size a photo from the *file* while a desktop sized it from the *box*; `test/site-features.js` asserts its absence.
- **Eight resize handles** (`ED_HANDLES`). A west or north drag moves the element's origin as well as its size — without that they are the south-east handle with different cursors.
- **Any element takes a background** (`_sdElBg`): colour, preset gradient, uploaded image, radius, padding. Gradients are a whitelist because the value lands in a `style` attribute on a public page.
- **Verification.** `test/browser/editor.js` (Chromium, run by hand — it is deliberately outside the `test/*.js` loop) drives gallery → Use → editor → select → type → gear → add → Done at **1440px and 390px**, measuring rendered geometry, DOM presence and real network traffic. Every editor bug in this feature's history was true of a variable and false of the screen, so measure the screen.

Both routes exist: **path-based `/site/:name`** and **host-based `name.resumetailored.com`**. The host-based path is an early middleware in `server.js` (`PERSONAL_SITE_HOST_RE`, before `express.static`) that maps a `<sub>.resumetailored.com` root request to the same renderer — it's **inert until a wildcard `*.resumetailored.com` DNS record + wildcard TLS point such hosts at the app** (apex, `www`, reserved names, the Railway/Netlify hosts and localhost all fall through unchanged). Provision DNS/TLS to activate it (see `docs/RAILWAY_SETUP.md` §9).

## Stripe integration

- Checkout is initiated via `POST /api/subscribe` (monthly, `mode: subscription`) → returns a Stripe Checkout URL. `POST /api/subscribe-lifetime` (`mode: payment`, requires `STRIPE_LIFETIME_PRICE_ID`) handles the one-time lifetime plan.
- `POST /webhook` receives `checkout.session.completed` (inserts into the `subscribers` table) and `customer.subscription.deleted` (deletes by `customer_id`). Lifetime buyers are stored with a sentinel `customer_id` of `lifetime_${email}` so subscription-deletion events never remove them.
- The webhook route must use `express.raw()` body parsing (already set up) — do not add `express.json()` middleware before it.
- `STRIPE_WEBHOOK_SECRET` must be set for webhook signature verification to pass.

## Email (optional)

Password reset emails and support contact messages are sent via Resend (`RESEND_API_KEY` env var). If `RESEND_API_KEY` is not set, reset links and support messages are logged to stdout instead. The app functions fully without it.

## Environment variables

Copy `.env.example` to `.env`. Required for full functionality:

```
ANTHROPIC_API_KEY     # Claude API
STRIPE_SECRET_KEY     # Stripe server-side
STRIPE_PUBLISHABLE_KEY # Stripe client-side (used in public pages)
STRIPE_WEBHOOK_SECRET # Stripe webhook signing secret
STRIPE_PRICE_ID       # Stripe Price ID for the monthly plan (price_...)
STRIPE_LIFETIME_PRICE_ID # optional — Price ID for the one-time lifetime plan
PORT                  # defaults to 3000
DATA_DIR              # optional — SQLite dir (default ./data; set /data + mount a Railway Volume to persist)
RESEND_API_KEY        # optional — enables real emails
OWNER_EMAIL           # optional — where support messages go (defaults to support@resumetailored.com)
LINKEDIN_CLIENT_ID     # optional — enables the free LinkedIn OAuth import button
LINKEDIN_CLIENT_SECRET # optional — pairs with LINKEDIN_CLIENT_ID
LINKEDIN_REDIRECT_URI  # optional — defaults to <origin>/api/auth/linkedin/callback
```

## Deployment

Deployed on Railway. `railway.json` configures the build (a Debian `Dockerfile`) and start command. All env vars must be added in the Railway dashboard. The Stripe webhook endpoint URL is `https://<your-railway-url>/webhook`.

To switch from Stripe test mode to live mode: replace all three Stripe env vars with live keys and create a new product/price in Stripe live mode.

## Competitive Positioning (SEO & Growth)

### Core Value Props (use consistently across all landing pages and content)
- **AI Model**: Powered by Anthropic Claude (claude-sonnet-4-6) — produces more natural, contextually rich writing than GPT-4 variants used by Teal, Kickresume, and most competitors
- **Free Tier**: unlimited free resume tailoring + cover letters, plus ATS scanner and LinkedIn optimizer/import — no credit card, no daily cap, forever (free account + small export watermark; premium templates, resume video and personal website are Pro)
- **Job URL Import**: Paste any LinkedIn, Indeed, Glassdoor, or 40+ job board URL — AI auto-extracts the full job description (no competitor offers this)
- **Bilingual**: Full English/Chinese UI + AI-powered translation for non-English resumes (unique in market)
- **Share as Link**: Turn any tailored resume into a private, unlisted web link (`/r/:slug`) that opens instantly in the browser — great for sending on LinkedIn or by email with no attachment/download
- **Pricing**: $19.99/mo (cheaper than Teal $29 and Jobscan ~$30) | $129 lifetime deal (vs Rezi $149)

### Competitor Intelligence
| Competitor | Monthly Traffic | Price | Key Weakness |
|---|---|---|---|
| Teal HQ (tealhq.com) | 2.81M/mo | $29/mo for AI | No AI resume rewriting on free tier; no cover letter |
| Jobscan (jobscan.co) | 2.05M/mo | ~$30/mo | Keyword SCORER only — does not rewrite resumes |
| Rezi (rezi.ai) | ~209K/mo | $29/mo or $149 LTD | GPT-based; weaker cover letter quality |
| Kickresume (kickresume.com) | Growing +15.8%/mo | $4.50/mo | GPT-4; two-column templates hurt ATS parse rate |
| Enhancv (enhancv.com) | ~297M/mo | $25/mo | Template SEO machine; hard to compete head-on |

### SEO Page Inventory
- `/alternatives/teal` → public/alternatives/teal.html
- `/alternatives/jobscan` → public/alternatives/jobscan.html
- `/alternatives/rezi` → public/alternatives/rezi.html
- `/teal-alternative` → public/teal-alternative.html (existing)
- `/rezi-alternative` → public/rezi-alternative.html (existing)
- `/jobscan-alternative` → public/jobscan-alternative.html (existing)
- `/kickresume-alternative` → public/kickresume-alternative.html (existing)
- `/tools/ats-keyword-extractor` → public/tools/ats-keyword-extractor.html (free tool, lead magnet)
- `/tools/resume-video` → public/tools/resume-video.html (free tool — embeds the in-browser `/preview` resume-video maker)
- `/resume-examples` → public/resume-examples.html (hub page targeting "resume examples" head term; internally links all 70 `*-resume.html` role pages grouped into 7 categories, plus a "By experience level" section linking the seniority variants. Role pages link back from their footers. `ItemList` + `BreadcrumbList` + `FAQPage` schema. Linked from homepage nav + footer.)
- `/cover-letter-examples` → public/cover-letter-examples.html (hub targeting "cover letter examples" head term; mirrors the resume hub for all 70 `*-cover-letter.html` role pages + seniority variants. Each role page has a role-specific sample opening + AI generator CTA and cross-links to its matching `*-resume` page. `ItemList` + `BreadcrumbList` + `FAQPage` schema.)
- `*-resume.html` / `*-cover-letter.html` → **70 base role pages** each, in 7 categories (Technology & Engineering, Business & Management, Finance & Sales, Healthcare & Education, Skilled Trades & Technical, Creative & Media, Hospitality & Service), served at `/{slug}-resume` and `/{slug}-cover-letter` via `express.static({ extensions: ['html'] })`.
- **Seniority variants**: `/{level}-{role}-resume` and `/{level}-{role}-cover-letter` where level ∈ `entry-level`/`senior`/`lead`, for 22 top roles = 66 variant pages each (132 total). Roles: tech + business (software-engineer, product-manager, project-manager, data-analyst, data-scientist, business-analyst, marketing-manager, web-developer, devops-engineer, ux-designer) and healthcare + finance + sales (registered-nurse, medical-assistant, nurse-practitioner, physical-therapist, pharmacist, accountant, financial-analyst, bookkeeper, financial-advisor, sales-representative, account-manager, sales-manager). Each has level-specific title/keywords/H1/FAQ/sample-opening (unique content so they rank separately from the base role) and a "By experience level" cross-link block to the base + sibling levels.
- All role/variant/hub pages (except the original 14 hand-authored `*-resume` pages) are generated from a single shared role dataset — see the generator scripts in git history — so counts, categories, cards and `ItemList` schema stay in sync. Adding roles or levels is a data edit.
- **Conversion CTA bar**: every example page (all `*-resume` / `*-cover-letter` pages + both hubs) loads `public/cta-bar.js` before `</body>` — a sticky, dismissible bottom bar (remembered in `localStorage`, GA `cta_bar_click` event) whose copy adapts to resume vs cover-letter by URL. Not shown on the homepage, blog, or app pages.
- `/blog/` → public/blog/index.html (blog index)

### Blog Content (public/blog/)
Each post exists as both `.html` (served) and `.md` (source). When adding a new blog post:
1. Create the `.html` file using the article layout from `jobscan-vs-resumetailored.html`
2. Create the `.md` source file
3. Add a card to `public/blog/index.html` in the posts grid

### Target Keywords (Priority Order)
1. "teal alternative" / "alternatives to teal resume"
2. "jobscan alternative" / "jobscan alternatives"
3. "rezi alternative" / "alternatives to rezi"
4. "tailor resume to job description AI"
5. "AI cover letter generator free"
6. "free ATS keyword extractor"
7. "bilingual resume generator English Chinese"
8. "best AI resume builder 2026"
9. "why Claude AI writes better resumes than ChatGPT"
