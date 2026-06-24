# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

ResumeTailor AI is a SaaS product that uses Claude (claude-sonnet-4-6) to tailor resumes and generate cover letters from job postings. It charges $19/month via Stripe and offers 1 free tailoring/day on the free tier.

## Commands

```bash
npm install       # install dependencies
npm run dev       # run with nodemon (auto-restarts on file changes)
npm start         # run without nodemon (production)
```

There are no tests and no linter configured.

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
  - `render.js` — server-side renderer: `bundle()` once (cached) + `selectComposition()` + `renderMedia()`. Uses Remotion's own **chrome-headless-shell** (downloaded via `ensureBrowser()`, pre-fetched at build in `nixpacks.toml`); it does **not** auto-detect a system Chromium, because recent Chromium builds removed the old headless mode Remotion needs ("Old Headless mode has been removed from the Chrome binary"). `nixpacks` still installs `chromium` for its shared libraries. An explicit `REMOTION_BROWSER_EXECUTABLE`/`CHROME_PATH` overrides, but only point it at a binary that still supports old headless.
  - `narration.js` — voiceover for the MP4. `generateNarrationAsync` tries, in order: **ElevenLabs** (studio-quality, when `ELEVENLABS_API_KEY` is set — uses the `/with-timestamps` endpoint for an mp3 + exact duration), then the local engine **Piper** (natural neural voice; Piper binary via `PIPER_BIN`/PATH/`python3 -m piper` + a voice model resolved from `PIPER_VOICE`/common dirs or best-effort downloaded), then **espeak-ng** (robotic), else silent. The script comes from `narrationScript` in `data.js`. `nixpacks.toml` installs Piper + the `en_US-lessac-medium` voice on Railway (guarded with `|| true`). The composition muxes the audio via `<Audio>` and extends to fit (`audioDurationInFrames`). The `/api/resume-video` route gates ElevenLabs to **subscribers** by default (`ELEVENLABS_FREE_TIER=on` opens it to all); `RESUME_VIDEO_VOICE=off` disables voice. Best-effort throughout: any failure ⇒ silent video, and the route retries silently if an audio render fails.
- **Endpoint**: `POST /api/resume-video` (`server.js`) takes `{ resume, name?, accentColor?, email }`, gated like other features (subscribers unlimited; free tier = 1/day via the `video` usage key). It renders one video at a time (`videoRenderInFlight` lock → 429 if busy), streams the MP4, and deletes the temp file. The heavy Remotion packages are `require()`d lazily inside the handler, so the server boots even if they aren't installed (route returns 501).
- **Frontend**: a "🎬 Resume Video" button in `renderPreviewDownloadButtons()` (`app.html`, hidden for cover-letter-only mode) calls `downloadVideo()`.
- **Web preview (no server render)**: `public/preview.html` (served at `/preview`) plays the composition live in the browser via [`@remotion/player`](https://www.remotion.dev/docs/player), loaded from esm.sh with React pinned through an import map — so it works on static hosting (Netlify deploy previews, mobile) with no Chromium. Supports **upload (PDF/DOCX/TXT, parsed client-side)** or paste, plus a voiceover synced to the player: a free **device voice** (Web Speech API, with a voice picker) or a **pro voice via ElevenLabs** (browser-direct — the user pastes their own API key, kept only in `localStorage` and sent only to ElevenLabs; no server key involved). Its scenes/parser/narration **mirror** the TSX + `data.js` in `remotion/` (kept deliberately in sync); the server-rendered MP4 remains the source of truth.
- **Local dev**: `npm run remotion:studio` (live preview/editor) and `npm run remotion:render` (CLI render to `out/`).
- **Deploy**: rendering needs Chromium + fonts. `nixpacks.toml` installs `chromium`, `fontconfig`, `dejavu_fonts`; the renderer auto-detects the binary. Rendering is CPU-heavy — keep the one-at-a-time lock.

## Persistent state (SQLite)

All server state is stored in a **SQLite database** (`better-sqlite3`) created in `server.js`. The DB file lives at `${DATA_DIR}/resumetailor.db` (`DATA_DIR` defaults to `./data`). For persistence across Railway deploys, set `DATA_DIR=/data` and mount a Railway Volume at `/data`; otherwise the DB is recreated in the ephemeral container on each deploy. WAL journaling is enabled.

Tables (all created with `CREATE TABLE IF NOT EXISTS` at startup):

| Table | What it tracks |
|---|---|
| `usage_store` | Free-tier usage counts, keyed by `${ip}_${date}_${type}` (`count`); `type` ∈ `resume`, `cover_letter`, `translate`, `video`, … |
| `subscribers` | Active Stripe subscribers (`email` PK, `customer_id`) |
| `users` | User accounts (`email` PK, `username`, SHA-256 `password_hash`) |
| `sessions` | Auth tokens (`token` PK → `email`) |
| `reset_tokens` | Password reset tokens (`token` PK, `email`, `expires_at`) |
| `check_ins` | Career check-in data by `email` |
| `forum_posts` / `forum_replies` | Community forum posts and their replies |

Access is via prepared statements (`db.prepare(...).run/get/all`). Note: several older docs/comments still reference in-memory `Map` objects — that design has been replaced by the SQLite tables above.

## Auth flow

Sessions use UUID tokens stored in the browser's `localStorage` (`rt_token`, `rt_email`, `rt_username`). The server validates tokens via `GET /api/auth/me`. `app.html` forces the auth modal on load if no valid token exists.

Passwords are hashed with SHA-256 using a static salt (`rta_salt_2026_` prefix). This is not bcrypt — do not treat it as production-grade.

## Free tier gating

`/api/tailor` checks two things before calling Claude:
1. Is the `email` parameter in an active Stripe subscription? (`isSubscriber()`)
2. If not subscribed, has the IP used its free quota today? (`hasFreeTierLeft()`)

Free usage is tracked per-feature in the `usage_store` table, keyed by `${ip}_${date}_${type}` (e.g. `resume`, `cover_letter`). It resets naturally at midnight because the date string changes; old rows simply stop being read.

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
```

## Deployment

Deployed on Railway. `railway.json` configures the build (Nixpacks) and start command. All env vars must be added in the Railway dashboard. The Stripe webhook endpoint URL is `https://<your-railway-url>/webhook`.

To switch from Stripe test mode to live mode: replace all three Stripe env vars with live keys and create a new product/price in Stripe live mode.

## Competitive Positioning (SEO & Growth)

### Core Value Props (use consistently across all landing pages and content)
- **AI Model**: Powered by Anthropic Claude (claude-sonnet-4-6) — produces more natural, contextually rich writing than GPT-4 variants used by Teal, Kickresume, and most competitors
- **Free Tier**: 1 completely free, full resume tailoring + cover letter per day — no credit card, no time limit, forever
- **Job URL Import**: Paste any LinkedIn, Indeed, Glassdoor, or 40+ job board URL — AI auto-extracts the full job description (no competitor offers this)
- **Bilingual**: Full English/Chinese UI + AI-powered translation for non-English resumes (unique in market)
- **Pricing**: $19/mo (35% cheaper than Teal $29 and Jobscan ~$30) | $129 lifetime deal (vs Rezi $149)

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
