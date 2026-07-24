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
| `personal_sites` | Pro personal websites at `/site/:name` (`subdomain` PK, indexable, watermark-free) |

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

Pro users publish a resume as a live public page (`personal_sites` table; `POST/GET/DELETE /api/personal-site`, Pro-gated via `isSubscriber`). Rendered at **`/site/:name`** — indexable and **watermark-free** — by the shared `_shareResumeHtml(row, origin, opts)` renderer (also used by `/r/:slug` share links, which stay noindex and keep the brand footer). Subdomains are validated (3–30 chars, `RESERVED_SUBDOMAINS` blocklist); one site per user.

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
