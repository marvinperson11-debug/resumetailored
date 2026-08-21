# ResumeTailored AI — Complete Project Handoff

> **Purpose:** Everything a new developer needs to take full control of ResumeTailored AI with zero prior knowledge — architecture, secrets, database, endpoints, deployment, features, and known issues.
>
> **Last updated:** 2026-08-21
> **Primary repository:** `marvinperson11-debug/resumetailored` (branch `main`)
> **Owner contact:** marvinperson11@gmail.com

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Structure](#2-repository-structure)
3. [Environment Variables & Secrets](#3-environment-variables--secrets)
4. [API Keys & Integrations](#4-api-keys--integrations)
5. [Database Schema](#5-database-schema)
6. [API Endpoints](#6-api-endpoints)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Deployment & CI/CD](#8-deployment--cicd)
9. [Domain & DNS](#9-domain--dns)
10. [Key Feature Code Flows](#10-key-feature-code-flows)
11. [Known Issues & Technical Debt](#11-known-issues--technical-debt)
12. [How to Run Locally](#12-how-to-run-locally)
13. [Testing](#13-testing)
14. [Monitoring & Logging](#14-monitoring--logging)
15. [Contact & Access](#15-contact--access)

---

## 1. Project Overview

**ResumeTailored AI** is a SaaS web app that uses Anthropic's Claude models to **tailor resumes and generate cover letters** from a job posting, plus an expanding suite of career tools (ATS scanner, LinkedIn optimizer, resume video generator, personal website builder, a "Career Hub" of skill/interview/job tools, and an Employer Portal).

### Business model

- **Free tier is unlimited** for the core tools (resume tailoring, cover letters, ATS scans, LinkedIn optimization) — requires a free login and is IP rate-limited. Free exports carry a small footer watermark and are limited to 6 basic templates.
- **Pro: $19.99/month or $129 lifetime** (Stripe) — removes the watermark, unlocks all 104 templates, resume video, and personal websites.
- **Employer Portal** has its own separate plan tiers (see `EMPLOYER_PORTAL_PLAN.md`).

### Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js (≥18, Docker uses Node 20), Express 4 — **one file: `server.js`** (~550 KB) |
| Frontend | Plain HTML/CSS/JS, **no framework, no build step**. SPA dashboard is `public/app.html` |
| Database | **SQLite** via `better-sqlite3` (single file, WAL mode) |
| AI | Anthropic Claude via `@anthropic-ai/sdk` (`claude-sonnet-4-6` for tailoring/reasoning, `claude-haiku-4-5` for high-volume generative endpoints) |
| Payments | Stripe (`stripe` SDK) |
| Email | Resend (primary) or SMTP via `nodemailer` (fallback); logs to stdout if neither configured |
| Video | **Remotion 4** (`remotion/`) — the only TypeScript/React in the repo; renders a vertical MP4 via a headless Chrome shell |
| File parsing | `pdf-parse` (PDF), `mammoth` (DOCX), `docx` (DOCX generation), `jimp` (images) |
| Hosting | **Railway** (Debian `Dockerfile`). Netlify hosts a static preview of `public/` only |
| Error tracking | Sentry (optional, `@sentry/node`) |
| Analytics | Google Analytics (gtag, measurement ID `G-JWC76X5X68`) |

### Architecture

```
                 ┌──────────────────────────────────────────────┐
   Browser  ───▶ │  Express app (server.js) on Railway           │
 (app.html,      │   • static file serving (public/)             │
  index.html,    │   • ~200 REST API routes under /api/*         │
  SEO pages)     │   • Stripe webhook (/webhook, raw body)       │
                 │   • host-based personal-site middleware       │
                 │                                                │
                 │   ├─▶ Anthropic Claude API (tailoring, tools) │
                 │   ├─▶ Stripe API (checkout, subscriptions)    │
                 │   ├─▶ Resend / SMTP (email)                    │
                 │   ├─▶ Job provider APIs (Adzuna, JSearch…)     │
                 │   ├─▶ Remotion renderer (spawns Chrome shell)  │
                 │   └─▶ SQLite DB (${DATA_DIR}/resumetailor.db)  │
                 └──────────────────────────────────────────────┘
```

- **No separate frontend server.** Express serves the static HTML and the API from the same process/origin. The frontend talks to the backend with `fetch` to same-origin `/api/*` routes, authenticating with a UUID token in `localStorage`.
- **Single repo, no monorepo tooling.** Remotion is a self-contained sub-project compiled on demand by Remotion's own bundler, not by the web app.

---

## 2. Repository Structure

```
resumetailored/
├── server.js                  ← ENTIRE backend (Express, routes, Stripe, Claude, auth, SQLite, DOCX)
├── package.json               ← deps + npm scripts
├── Dockerfile                 ← Debian build for Railway (Chrome libs, fonts, Piper voices)
├── railway.json               ← Railway build/deploy config (uses Dockerfile)
├── netlify.toml               ← static preview of public/ only
├── .env.example               ← template for all env vars (copy to .env)
│
│   ── Pure, unit-tested backend modules (no DB/network) ──
├── career-hub.js              ← Career Hub core: taxonomy, prompt builders, validators, quiz scoring, limits
├── badge-page.js              ← public /badge/:slug share-page HTML
├── employer-hub.js            ← Employer Portal pure core
├── job-providers.js           ← multi-source job search fan-out (Adzuna, JSearch, USAJOBS, remote fallbacks)
├── llms-txt.js                ← generateLlmsTxt() for per-site AI-crawler index
├── resume-writeback.js        ← the ONLY code that writes to saved_resumes (site→resume sync)
├── site-templates.js          ← personal-website template definitions
├── tools-core.js              ← Pro-tools pure helpers
├── security.js                ← security middleware/helpers
├── career-cron.js             ← in-process daily scheduler (warm cache, job digest, etc.)
│
│   ── Remotion resume-video project (only TS/React) ──
├── remotion/
│   ├── index.ts, Root.tsx     ← registerRoot + ResumeVideo composition
│   ├── ResumeVideo.tsx, scenes/ ← animated scenes (Intro, Highlights, Skills, Outro…)
│   ├── data.js                ← CommonJS single source of truth for props + scene timing
│   ├── parseResume.js         ← plain-text resume → ResumeVideoProps (language/gender aware)
│   ├── narration.js           ← voiceover: ElevenLabs → Piper → espeak-ng → silent
│   ├── render.js              ← server-side renderer (bundle + selectComposition + renderMedia)
│   └── music.js, theme.ts, types.ts
│
│   ── Frontend (static, served from public/) ──
├── public/
│   ├── index.html             ← landing page
│   ├── app.html               ← main dashboard SPA (tabs via showTab(), no router)
│   ├── preview.html           ← in-browser resume-video preview (Remotion Player, no server)
│   ├── style.css, theme.css, css/app.css, career-hub.css …
│   ├── app.html-injected JS   ← career-hub.js, tools-hub.js, job-tracker.js, site-*.js, mobile-native.js
│   ├── data/professions.json  ← Career Hub taxonomy (10 categories / ~67 professions)
│   ├── panels/                ← HTML partials loaded into app.html tabs
│   ├── *-resume.html / *-cover-letter.html  ← 70 SEO role pages + 132 seniority variants
│   ├── alternatives/, tools/, blog/, zh/    ← SEO + blog + Chinese pages
│   ├── emails-adjacent success/cancel/reset pages
│   └── fonts/, vibes/, ads/, flyers/, social-media/  ← assets
│
├── emails/publish-success.html  ← the one file-based email template ({{TOKEN}} substitution)
├── scripts/                   ← cron jobs & build scripts (warm-career-cache, job-digest, build-fonts, gen_ads…)
├── docs/                      ← ~80 design/status/decision docs (RAILWAY_SETUP.md, RAILWAY_CRON.md, TESTING.md…)
├── test/                      ← plain-Node test scripts (see §13); test/browser/ = manual Chromium tests
├── assets/                    ← marketing banners
└── *.md (root)                ← historical plan/audit/report docs (CLAUDE.md is the authoritative guide)
```

**`CLAUDE.md` in the repo root is the single most important document** — it is the maintained, detailed engineering guide to every subsystem. Read it first.

---

## 3. Environment Variables & Secrets

Copy `.env.example` → `.env` for local dev. In production, all vars are set in the **Railway dashboard** (Service → Variables). **No secret values are stored in the repo.** SQLite is the only persistent store; there is no external secrets manager.

### Required for full functionality

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API — powers tailoring, cover letters, and all AI tools |
| `STRIPE_SECRET_KEY` | Stripe server-side API |
| `STRIPE_PUBLISHABLE_KEY` | Stripe client-side key (injected into public pages) |
| `STRIPE_WEBHOOK_SECRET` | Verifies `/webhook` signatures — **required** or webhooks fail |
| `STRIPE_PRICE_ID` | Price ID for the $19.99/mo plan (`price_...`) |

### Common config

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default `3000`) |
| `DATA_DIR` | SQLite directory (default `./data`; set `/data` + mount a Railway Volume to persist across deploys) |
| `PUBLIC_ORIGIN` | Canonical public origin, used for building absolute URLs |
| `NODE_ENV` | Standard Node environment flag |
| `ADMIN_SECRET` | Guards admin routes (`/api/admin/*`) |
| `COMP_EMAILS` | Comma-separated emails treated as comped/unlimited subscribers |
| `OWNER_EMAIL` | Where support + owner activity alerts go (default `support@resumetailored.com`) |
| `OWNER_ALERTS` | `on`/`off` — owner activity alert emails (signup, tailor, sub, login, download) |

### Payments (optional plans)

| Variable | Purpose |
|---|---|
| `STRIPE_LIFETIME_PRICE_ID` | One-time $129 lifetime plan |
| `STRIPE_EMPLOYER_PRICE_ID` / `STRIPE_EMPLOYER_PRO_PRICE_ID` / `STRIPE_EMPLOYER_SCALE_PRICE_ID` | Employer Portal plan tiers |

### Email

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend email (password resets, support, publish confirmations). If unset, emails log to stdout |
| `EMAIL_FROM` | From address for outbound mail |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | SMTP fallback via nodemailer |

### AI / Video / Voice

| Variable | Purpose |
|---|---|
| `ELEVENLABS_API_KEY` | Studio-quality MP4 voiceover (subscribers only by default) |
| `ELEVENLABS_VOICE_ID` / `ELEVENLABS_MODEL_ID` | ElevenLabs voice + model |
| `ELEVENLABS_FREE_TIER` | `on` opens ElevenLabs voice to all users (spends credits) |
| `RESUME_VIDEO_VOICE` | `off` disables voiceover entirely |
| `PIPER_BIN` / `PIPER_VOICE` / `PIPER_VOICE_ID` / `PIPER_DATA_DIR` / `PIPER_AUTODOWNLOAD` | Local Piper TTS overrides |
| `REMOTION_BROWSER_EXECUTABLE` / `CHROME_PATH` | Override Chrome binary for Remotion (must support old headless mode) |
| `MEDIA_MAX_VIDEO_SEC` | Overrides 120s site-media video cap (tests only) |

### Job providers (Career Hub Job Finder)

| Variable | Purpose |
|---|---|
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` / `ADZUNA_COUNTRY` | Adzuna (recommended — nationwide US coverage). Free at developer.adzuna.com |
| `RAPIDAPI_KEY` | JSearch via RapidAPI (needs active JSearch subscription) |
| `USAJOBS_API_KEY` / `USAJOBS_EMAIL` | US federal jobs |
| `JOB_FALLBACKS_OFF` | `1` disables the zero-key remote fallback providers |
| `JOB_FEED_RSS_URLS` | Company career-page RSS feeds (`profession_id|label|url` triples) |
| `INDEED_PUBLISHER_ID` / `ZIPRECRUITER_API_KEY` | Stubbed until real partner credentials exist |

### OAuth (optional social login/import)

| Variable | Purpose |
|---|---|
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` / `LINKEDIN_REDIRECT_URI` | "Continue with LinkedIn" + profile import (OIDC) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | "Continue with Google" (OIDC) |

### Scheduling / cron (in-process, off by default)

| Variable | Purpose |
|---|---|
| `CAREER_CRON` | `on` enables the in-process daily scheduler (needs the web service's SQLite volume) |
| `CAREER_WARM_HOUR_UTC` / `CAREER_DIGEST_HOUR_UTC` / `WEEKLY_REPORT_HOUR_UTC` / `EMPLOYER_NURTURE_HOUR_UTC` | Cron run hours |
| `JOB_FEED_REFRESH_HOURS` | Job feed refresh cadence (1–24h) |
| `WARM_LANGS` / `WARM_SENIORITY` | Cache-warming scope (langs default `en`; `en,zh` = ~2× credits) |
| `DRY_RUN` | Dry-run flag for cron scripts |

### Ops / misc

| Variable | Purpose |
|---|---|
| `SENTRY_DSN` | Error reporting (inert if unset) |
| `RT_DISABLE_RATE_LIMIT` | `1` disables all rate limiting — **local test use only, never in production** |
| `RT_LEGACY_FONTS` | Legacy font toggle |
| `SITE_PUBLIC_HOST` | Switch published sites to `<name>.resumetailored.com` (needs wildcard DNS + TLS first) |
| `RAILWAY_GIT_COMMIT_SHA` | Injected by Railway; surfaced for build identification |
| `ZH_BUILD_BASE` | Base for the Chinese static build script |

---

## 4. API Keys & Integrations

| Service | Used for | Key variable(s) | Get a key / dashboard |
|---|---|---|---|
| **Anthropic (Claude)** | Resume tailoring, cover letters, all AI tools | `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| **Stripe** | Subscriptions ($19.99/mo, $129 lifetime), Employer plans, webhooks | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `STRIPE_LIFETIME_PRICE_ID`, `STRIPE_EMPLOYER_*` | https://dashboard.stripe.com |
| **Resend** | Transactional email (resets, support, publish) | `RESEND_API_KEY` | https://resend.com/dashboard |
| **SMTP (nodemailer)** | Email fallback | `SMTP_*` | Your mail provider |
| **ElevenLabs** | Premium MP4 voiceover | `ELEVENLABS_API_KEY` | https://elevenlabs.io |
| **Adzuna** | Job Finder (recommended source) | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | https://developer.adzuna.com |
| **JSearch (RapidAPI)** | Job Finder (alt source) | `RAPIDAPI_KEY` | https://rapidapi.com (subscribe to JSearch API) |
| **USAJOBS** | US federal jobs | `USAJOBS_API_KEY`, `USAJOBS_EMAIL` | https://developer.usajobs.gov |
| **LinkedIn** | OAuth login + profile import (OIDC) | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | https://www.linkedin.com/developers |
| **Google** | OAuth login (OIDC) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | https://console.cloud.google.com/apis/credentials |
| **Railway** | Hosting / deploy | (dashboard-managed) | https://railway.app/dashboard |
| **Netlify** | Static preview of `public/` | (dashboard-managed) | https://app.netlify.com |
| **Sentry** | Error tracking | `SENTRY_DSN` | https://sentry.io |
| **Google Analytics** | Web analytics (gtag `G-JWC76X5X68`) | hard-coded in HTML | https://analytics.google.com |

- **Auth provider:** none external by default — auth is self-hosted (bcrypt + UUID session tokens in SQLite). LinkedIn/Google are optional social logins.
- **File storage:** local disk under `${DATA_DIR}/site-media` (no S3/R2). Persist via a Railway Volume.
- **Database host:** none external — SQLite file on disk.

---

## 5. Database Schema

**Engine:** SQLite (`better-sqlite3`), WAL journaling, file at `${DATA_DIR}/resumetailor.db` (default `./data`). All tables are created at startup with `CREATE TABLE IF NOT EXISTS`. Access is via prepared statements (`db.prepare(...).run/get/all`). **There is no migration framework** — schema evolves by additive `CREATE TABLE IF NOT EXISTS` and a helper `_ensureColumn()` that adds missing columns to existing tables at boot. No seed data.

### Tables (grouped)

**Core auth & billing**
| Table | Tracks |
|---|---|
| `users` | Accounts (`email` PK, `username`, bcrypt `password_hash`) |
| `sessions` | Auth tokens (`token` PK → `email`) |
| `reset_tokens` | Password reset tokens (`token` PK, `email`, `expires_at`) |
| `subscribers` | Active Stripe subscribers (`email` PK, `customer_id`; lifetime buyers use sentinel `lifetime_${email}`) |
| `usage_store` | Per-feature usage counts keyed `${ip}_${date}_${type}` (now only `translate`, `video`, dedup alerts) |
| `audit_log` | Security/audit events |

**User content**
| Table | Tracks |
|---|---|
| `saved_resumes` | Saved resumes (only table `resume-writeback.js` writes to) |
| `saved_cover_letters` | Saved cover letters |
| `saved_videos` | Generated resume videos |
| `resume_versions` | Resume version history (Pro tools) |
| `shared_resumes` | Snapshots behind `/r/:slug` share links (indexable, watermarked) |
| `check_ins` | Career check-in + **saved profession** (`profession_id`, `profession_cat`, `seniority`, `lang`, `job_alerts`) — drives the Career Hub |
| `applications` / `job_applications` | Job application tracker |
| `forum_posts` / `forum_replies` | Community forum |

**Personal websites**
| Table | Tracks |
|---|---|
| `personal_sites` | Pro personal sites at `/site/:name` (`subdomain` PK; ≤1 published per user) |
| `site_aliases` | Rename forwarding (`old_sub` PK → `new_sub`, 301) |
| `site_media` | Uploaded media per site (`site_sub` scopes each row; 5 videos / 2 min / 1 GB limits) |
| `site_visits` / `site_leads` / `site_analytics`-adjacent | Site traffic + lead capture |

**Career Hub — cross-user content caches** (keyed by content hash + `PROMPT_VERSION`, language-namespaced)
| Table | Tracks |
|---|---|
| `quiz_cache` / `interview_cache` / `gap_cache` / `scenario_cache` / `job_cache` | Generated content, generated once for the whole user base |
| `job_feed` | "Jobs for You" aggregated feed |

**Career Hub — per-user**
| Table | Tracks |
|---|---|
| `skill_attempts` | Skills Lab quiz attempts |
| `badges` | Earned badges |
| `interview_progress` | Interview practice progress |
| `gap_reports` | Gap Analyzer reports |
| `saved_jobs` | Saved jobs |
| `scenario_progress` | Scenario Lab progress |
| `weekly_report_subscriptions` | Weekly report opt-ins |
| `tool_usage` | Pro-tools usage |

**Employer Portal**
| Table | Tracks |
|---|---|
| `employer_profiles` | Employer accounts |
| `employer_subscribers` | Employer plan subscriptions |
| `job_postings` | Employer job posts |
| `candidate_profiles` | Candidate-side profiles |
| `employer_messages` | Employer↔candidate messaging |
| `employer_contact_requests` | Contact requests |
| `employer_ai_matches` | AI candidate/job matches |
| `interviews` | Scheduled interviews |
| `employer_nurture` | Nurture-email state |

> Relationships are enforced in application code (email-keyed joins), not by SQL foreign keys. Indexes are added inline in `server.js` where needed (e.g. `site_media.site_sub`).

---

## 6. API Endpoints

~200 routes, all defined in `server.js`. **Auth:** routes needing a signed-in user call `getSessionEmail(req)` (reads the `Authorization`/token) and 401 if absent. Responses are JSON unless noted. Grouped summary below — full list follows.

### Auth
| Method / Route | Purpose | Auth |
|---|---|---|
| POST `/api/auth/signup` | Create account (bcrypt) | no |
| POST `/api/auth/login` | Login → session token | no |
| POST `/api/auth/logout` | Invalidate token | yes |
| GET `/api/auth/me` | Validate token, return user | yes |
| POST `/api/auth/forgot-password` | Send reset link | no |
| POST `/api/auth/reset-password` | Reset with token | no |
| GET `/api/auth/verify-reset-token` | Check reset token validity | no |
| GET `/api/auth/linkedin` / `/callback` / `/draft` / `/session` / `/status` | LinkedIn OAuth login + import | no |
| GET `/api/auth/google` / `/callback` / `/session` / `/status` | Google OAuth login | no |
| DELETE `/api/user/me` | Delete account | yes |
| GET `/api/user/me/export` | Export user data | yes |

### Core AI tools
| Method / Route | Purpose | Auth |
|---|---|---|
| POST `/api/tailor` | Tailor a resume to a job (Claude) — **signed-in + IP rate-limited (20/min)** | yes |
| POST `/api/cover-letters` (+ GET, DELETE, `/:id/duplicate`) | Cover letter CRUD + generation | yes |
| POST `/api/ats-scan` | ATS keyword/score scan | yes |
| POST `/api/optimize-linkedin` | LinkedIn profile optimizer | yes |
| POST `/api/translate-resume` | Translate resume (1/day free) | yes |
| POST `/api/extract-text` | Parse uploaded PDF/DOCX/TXT | yes |
| POST `/api/fetch-job-url` | Extract job description from a job-board URL | yes |
| POST `/api/resumes` (+ GET, DELETE `/:id`, `/:id/duplicate`) | Saved resume CRUD | yes |
| POST `/api/download-docx` | DOCX export (server-side template gating + watermark) | yes |
| POST `/api/share` → GET `/r/:slug` | Shareable resume link | yes / public |

### Resume video (Remotion)
| Method / Route | Purpose |
|---|---|
| POST `/api/resume-video` | Render MP4 (Pro-only, one-at-a-time lock → 429 if busy) |
| GET `/api/resume-video/status/:jobId` / `/file/:jobId` | Poll + download |
| GET `/api/video-voices` / `/api/video-outros` | Voice + outro options |
| GET `/api/videos` (+ DELETE `/:id`) | Saved videos |

### Personal websites (Pro)
| Method / Route | Purpose |
|---|---|
| POST `/api/personal-site` (+ PATCH, DELETE) | Create/update/unpublish (publishing unpublishes others) |
| GET `/api/personal-sites` (+ DELETE `/:sub`, GET `/:sub/render`) | List / delete / owner render |
| POST `/api/personal-site/preview` | Live editor iframe render (`editable:true`) |
| POST `/api/personal-site/autogen` | Auto-generate a site from a resume |
| GET/POST/DELETE `/api/site-media` (+ `/:id`) | Media uploads (streamed to disk, per-site limits) |
| GET `/api/site-templates` (+ `/:id`, `/:id/preview`) | Template gallery |
| GET `/api/site-vibes`, `/api/site-qr`, `/api/site-analytics`, `/api/site-leads` | Extras |
| POST `/api/site-lead` | Lead capture from a published site |
| GET `/site/:sub` (+ `/:page`, `/cover-letter`, `/llms.txt`) | Public rendered site |
| GET `/media/:id` | Serve uploaded media |

### Career Hub
| Method / Route | Purpose |
|---|---|
| GET/POST `/api/profession` | Get/set the user's saved profession |
| POST `/api/skills-lab/quiz` / `/submit`, GET `/api/skills-lab/attempts` | Skills Lab (answers stripped client-side) |
| POST `/api/interview/questions` / `/score` / `/progress` | Interview practice |
| POST `/api/skills-gap`, GET `/api/skills-gap/reports` | Gap Analyzer |
| POST `/api/scenario-lab/scenario` / `/complete` | Scenario Lab |
| GET `/api/jobs/search`, POST `/api/jobs/save`, GET/DELETE `/api/jobs/saved`, GET/POST `/api/jobs/alerts`, GET `/api/job-feed` | Job Finder + feed + alerts |
| GET `/api/career/dashboard` / `/coach` | Dashboard + AI coach summary (Pro) |
| GET `/badge/:slug` | Public share badge page |

### Pro tools
`/api/tools/*` — `extract-keywords`, `job-description-decode`, `mock-interview`, `offer-comparison`, `salary-negotiation`, `follow-up-generate`, `weekly-report` (+ `/toggle`), `resume-version` CRUD (+ `/:id/diagnose`).

### Job application tracker
`/api/applications` (GET/POST/PUT/DELETE `/:id`), `/api/applications/stats`, `/api/applications/export`, `/api/applications/autofill/jobs`.

### Employer Portal
`/api/employer/*` — `status`, `profile`, `settings`, `subscribe`, `jobs` (CRUD + `/:id/applications`, `/matches`, `/ai-matches`, `/apply`), `candidates` (+ `/:email/profile`, `/:email/contact`, `export.csv`), `messages`, `interviews`, `analytics`, `overview`; candidate side: `/api/candidate/profile`, `/api/candidate/contact-requests`. Public: `GET /company/:slug`.

### Billing / webhooks
| Method / Route | Purpose |
|---|---|
| POST `/api/subscribe` | Start $19.99/mo Stripe Checkout |
| POST `/api/subscribe-lifetime` | Start $129 one-time Checkout |
| POST `/api/employer/subscribe` | Employer plan checkout |
| POST `/webhook` | Stripe webhook (**`express.raw()` body — do not add `express.json()` before it**) |

### Misc / ops
`GET /api/health`, `GET /api/status`, `GET /api/test-ai`, `GET /api/checkin` + POST, `GET/POST /api/forum` (+ `/:id/like`, `/:id/reply`), `POST /api/contact`, `POST /api/client-error`, `GET /api/assets/summary`, admin: `GET /api/admin/users-list`, `POST /api/admin/broadcast` (guarded by `ADMIN_SECRET`). Page routes: `/app`, `/dashboard`, `/login`, `/signup`, `/about`, `/blog`, `/preview`, plus static `*-resume` / `*-cover-letter` / `*-alternative` pages via `express.static({ extensions:['html'] })`.

---

## 7. Authentication & Authorization

- **Mechanism:** self-hosted. Passwords hashed with **bcrypt** (`bcryptjs`, per-record salt, `BCRYPT_ROUNDS=10`). Sessions are **UUID tokens** stored server-side in the `sessions` table and in the browser's `localStorage` (`rt_token`, `rt_email`, `rt_username`).
- **Validation:** the client sends the token; `GET /api/auth/me` validates it. `app.html` forces the auth modal on load when no valid token exists.
- **Legacy migration:** accounts created before bcrypt used static-salt SHA-256 (`rta_salt_2026_` prefix). Those hashes still verify and are **transparently re-hashed to bcrypt on next successful login** (`verifyPassword`/`isLegacyHash`).
- **Social login:** optional LinkedIn / Google OIDC. LinkedIn `mode=login` upserts a passwordless account and opens a session; `mode=import` returns a one-time profile draft.
- **Authorization / gating:**
  - `getSessionEmail(req)` → identity; missing = 401 on protected routes.
  - `isSubscriber(email)` → Pro status (checked against `subscribers` table + `COMP_EMAILS`). Gates watermark removal, premium templates, resume video, personal websites, and Pro-only Career Hub tools.
  - **Template gating is server-side** in `/api/download-docx` via `FREE_TPL_SIGS` / `isFreeTemplateMeta` (the client `OUT_TPLS` `free:true` flags mirror it — keep in sync).
  - Free-tier metering for the few metered features uses `usage_store` (`hasFreeTierLeft`/`consumeFreeTier`) and the Career Hub `CH.LIMITS` day/week/total buckets.
  - Admin routes require `ADMIN_SECRET`.
- **Rate limiting:** `express-rate-limit` — `tailorLimiter` (20/min on `/api/tailor`), auth limiters, employer limiters, a global API limiter. `RT_DISABLE_RATE_LIMIT=1` disables all (local only).
- **Token expiration:** sessions persist until logout/deletion (no hard TTL); reset tokens expire via `reset_tokens.expires_at`.

---

## 8. Deployment & CI/CD

### Hosting

- **Primary: Railway**, built from the **Debian `Dockerfile`** (not Nixpacks — Remotion's chrome-headless-shell can't link against Nixpacks library paths). `railway.json` sets `builder: DOCKERFILE`, start command `node server.js`, restart on failure (max 3 retries).
- **Netlify** hosts only a static preview of `public/` (no backend) — see `netlify.toml`.

### Build process (`Dockerfile`)

1. `node:20-bookworm-slim` base.
2. apt-install Chrome headless-shell runtime libs (`libnss3`, `libgbm-dev`, `libasound2`, …), fonts (`fontconfig`, `fonts-dejavu-core`, `fonts-noto-color-emoji`), `espeak-ng`, Python/pip, build tools (for `better-sqlite3`).
3. `npm install --omit=dev` (retried up to 3× for flaky registry).
4. Copy source.
5. Pre-download Remotion's chrome-headless-shell via `ensureBrowser()` (best-effort).
6. `pip install piper-tts` + download voices (lessac female, ryan male, huayan zh) — best-effort.
7. `CMD ["node", "server.js"]`, `EXPOSE 3000`.

### Environments

- No formal staging; Railway production + Netlify preview. All env vars live in the Railway dashboard.

### CI (`.github/workflows/tests.yml`)

- Runs on PRs and pushes to `main`. Node 20, `npm ci`, then loops `test/*.js` running each with `node`, grouping output. Browser tests in `test/browser/` are **excluded** (run manually).

### Deploy / rollback

- **Deploy:** push to `main` (Railway auto-builds from the connected repo) or trigger a deploy in the Railway dashboard.
- **Rollback:** Railway dashboard → Deployments → redeploy a previous successful build. The Railway MCP tools (`list-deployments`, `redeploy`, `create-deployment`) are also available for ops.
- **Persistence:** set `DATA_DIR=/data` and mount a Railway Volume at `/data`, or the SQLite DB (and uploaded media) is wiped on every deploy.
- **Scheduled jobs** run **in-process** (`career-cron.js`, enabled with `CAREER_CRON=on`) rather than as separate Railway cron services, because they need the web service's local SQLite Volume — see `docs/RAILWAY_CRON.md`.

---

## 9. Domain & DNS

- **Primary domain:** `resumetailored.com` (registrar/DNS provider is managed outside the repo — confirm with the owner; see `docs/RAILWAY_SETUP.md`).
- **App host:** Railway-provided host + custom domain mapping. Stripe webhook endpoint is `https://<railway-url>/webhook`.
- **SSL:** managed by Railway (and Netlify for the preview).
- **Subdomains / personal sites:** published sites are served at `/site/:name` by default. A **host-based route** (`<sub>.resumetailored.com`) exists in `server.js` (`PERSONAL_SITE_HOST_RE`, before `express.static`) but is **inert until a wildcard `*.resumetailored.com` DNS record + wildcard TLS certificate** point such hosts at the app. Activate by provisioning DNS/TLS and setting `SITE_PUBLIC_HOST` (see `docs/RAILWAY_SETUP.md` §9). Apex, `www`, reserved names, and the Railway/Netlify hosts fall through unchanged.
- **DNS records to expect:** `A`/`CNAME` for apex + `www` → Railway; `MX`/`TXT` for email/Resend domain verification; wildcard `CNAME`/`A` for `*.resumetailored.com` once personal-site subdomains are activated. Exact records live at the DNS provider, not in the repo.

---

## 10. Key Feature Code Flows

All backend logic is in `server.js` unless noted.

- **Resume tailor** — `POST /api/tailor`: requires login, IP rate-limited (20/min). Builds a Claude prompt from the resume + job description, calls `claude-sonnet-4-6`, returns tailored text. Frontend lives in `app.html` (tabs via `showTab()`).
- **Cover letter** — `POST /api/cover-letters`: same Claude pattern; CRUD persists to `saved_cover_letters`.
- **ATS scanner** — `POST /api/ats-scan`: extracts keywords + scores resume-vs-JD alignment.
- **Resume video** — `POST /api/resume-video` (Pro-only, 402 otherwise): lazily `require()`s Remotion, `parseResume.js` converts text → props, `render.js` bundles once (cached) and `renderMedia()` produces the MP4 with a global one-at-a-time lock (429 if busy); voiceover via `narration.js` (ElevenLabs → Piper → espeak → silent). Web preview at `/preview` uses `@remotion/player` in-browser (no Chromium).
- **Website builder** — the rail editor (`cvShell` in `app.html`) renders the site through `POST /api/personal-site/preview` with `editable:true` (same renderer as the published page + `_sdEditLayer` inline editor). Sites persist in `personal_sites`; publishing at `POST /api/personal-site` unpublishes the user's other sites, shows a toast, redirects to `publish-success.html`, and fire-and-forget emails a confirmation. Templates in `site-templates.js`; document model in `public/site-doc-store.js`. **This is the most intricate subsystem — read the "Personal portfolio websites" and "The editor" sections of `CLAUDE.md` before touching it.**
- **Job application tracker** — `/api/applications/*`, table `applications`/`job_applications`; frontend `public/job-tracker.js`.
- **Shareable link** — `POST /api/share` snapshots a resume into `shared_resumes`, served publicly (indexable, watermarked) at `GET /r/:slug` via `_shareResumeHtml()`.
- **Photo / media upload** — `POST /api/site-media`: streamed to disk (`multer.diskStorage`, temp dir on the same filesystem so the final step is a `rename`), per-site limits (5 videos / 2 min each / 1 GB), video duration probed from container header via `@remotion/media-parser` (fails open). Every rejection path unlinks the temp file (`bail()`).
- **Career Hub** — pure core in `career-hub.js` (taxonomy, prompt builders, validators, quiz scoring, `LIMITS`, dashboard `computeNextSteps`); routes in `server.js` wire it to SQLite + Anthropic + job providers; cross-user caches (`quiz_cache`, etc.) keyed by content hash + `PROMPT_VERSION` and namespaced by language. Frontend `public/career-hub.js` self-injects into `app.html`.

---

## 11. Known Issues & Technical Debt

- **`server.js` is a ~550 KB single file** holding the entire backend. High-value target for modularization; currently the biggest maintainability risk.
- **No migration framework.** Schema changes rely on `CREATE TABLE IF NOT EXISTS` + a boot-time `_ensureColumn()` helper. Column renames/drops are not supported cleanly.
- **SQLite single-writer.** Fine at current scale, but a horizontal scale-out or high write concurrency would require moving off SQLite. Also means persistence depends entirely on the mounted Railway Volume — a missing/unmounted volume silently wipes all data on deploy.
- **Stale docs.** ~80 root/`docs/` markdown files are historical plan/status snapshots; several older ones reference in-memory `Map` state that was replaced by SQLite. **`CLAUDE.md` is the authoritative doc**; treat the rest as history.
- **Resume-sync offer is wired but dormant.** The `POST /api/resume-sync` route, `resume-writeback.js`, and the in-page offer UI all exist, but nothing currently posts `__rtSync` into the canvas, so users are never prompted. Re-enabling means re-adding that message + handling `syncAnswer` in the `app.html` canvas bridge.
- **Free/Pro template lists are duplicated** (`FREE_TPL_SIGS` server-side vs `OUT_TPLS` `free:true` client-side) and must be manually kept in sync.
- **Remotion is fragile in deployment** — depends on a specific chrome-headless-shell that requires old headless mode; recent Chromium builds break it. The Debian Dockerfile is a deliberate workaround for Nixpacks failures ("Closed with 127").
- **Video rendering is CPU-heavy** and serialized by a single in-process lock — a real bottleneck if video usage grows.
- **Job provider stubs** — Indeed/ZipRecruiter adapters in `scripts/refresh-job-feed.js` are stubbed pending partner credentials.
- **Deprecation:** several helper functions (`hasFreeTierLeft`/`consumeFreeTier`/`getUsageKey`) remain from the old metered-free-tier model and are now only used by `translate`/`video`.

---

## 12. How to Run Locally

### Prerequisites

- **Node.js ≥ 18** (Docker/CI use 20). npm.
- Build tools for `better-sqlite3` native compilation (Xcode CLT on macOS, `build-essential` on Linux).
- Optional for video: Python 3 + `piper-tts`, `espeak-ng`; Remotion downloads its own Chrome shell.

### Steps

```bash
git clone https://github.com/marvinperson11-debug/resumetailored.git
cd resumetailored
npm install                 # installs deps, compiles better-sqlite3

cp .env.example .env        # then fill in at least ANTHROPIC_API_KEY + Stripe keys
                            # the app boots without them but AI/payment features are inert

npm run dev                 # nodemon, auto-restart  (or: npm start for production mode)
# → http://localhost:3000
```

- The SQLite DB is created automatically at `./data/resumetailor.db` on first run.
- Without `ANTHROPIC_API_KEY`, AI endpoints error; without Stripe keys, checkout is inert; without `RESEND_API_KEY`/SMTP, emails print to stdout. Everything else runs.

### Other useful scripts

```bash
npm run remotion:studio     # live Remotion editor
npm run remotion:render     # CLI render to out/
npm run career:warm         # pre-generate Career Hub caches (needs ANTHROPIC_API_KEY)
npm run career:job-digest   # daily job digest email (needs RAPIDAPI_KEY + RESEND_API_KEY)
```

---

## 13. Testing

- **Framework:** none. Tests are **plain Node scripts** in `test/`, each run directly and each printing `ALL PASS` or a list of failures.
- **Run all:**
  ```bash
  for f in test/*.js; do node "$f"; done
  ```
- **CI** runs exactly this loop (`.github/workflows/tests.yml`) on PRs/pushes to `main`.
- **Coverage:** the Website Creator document model + rendering parity + publishing + inline editing + resume write-back; Career Hub pure core (`career-hub.js`) and full route integration against a temp DB (`career-hub-routes.js`, generative routes exercised via pre-seeded caches so no LLM/API calls); media limits & site scoping & disk-upload rejection paths; security routes; job providers; llms.txt; homepage a11y/console/motion; static-asset caching; and more (~45 test files).
- **Browser tests** (`test/browser/editor.js`, `sidebar-breakpoint.js`, `template-overlap.js`) drive **real Chromium via Playwright** measuring rendered geometry. They are **deliberately outside the `test/*.js` loop** — run by hand:
  ```bash
  node test/browser/editor.js
  ```
- **Not covered:** live Stripe/Anthropic/job-provider calls (mocked or cache-seeded), and the Remotion server render pipeline end-to-end.

---

## 14. Monitoring & Logging

- **Error tracking:** Sentry (`@sentry/node`), enabled only when `SENTRY_DSN` is set. Uncaught route errors are reported with passwords/tokens/API keys scrubbed first. Fully inert (server boots identically) when unset.
- **Client errors:** `POST /api/client-error` collects front-end errors.
- **Owner activity alerts:** email to `OWNER_EMAIL` on signup / tailor / new+cancelled subscription / login / download (toggle with `OWNER_ALERTS=off`).
- **Analytics:** Google Analytics via gtag (measurement ID `G-JWC76X5X68`), fired from the public pages and the app (`quiz_start`, `job_save`, `cta_bar_click`, etc.).
- **Health:** `GET /api/health` and `GET /api/status`.
- **Logs:** stdout/stderr → **Railway dashboard → Deployments → Logs** (or the Railway MCP `get-logs` tool). Emails fall back to stdout when no email provider is configured.
- **Uptime:** no dedicated uptime monitor in the repo — recommend adding one (e.g. against `/api/health`).

---

## 15. Contact & Access

> **These are organizational facts not stored in the repo — confirm and fill in with the current owner during handoff.**

- **Project owner:** marvinperson11@gmail.com
- **GitHub:** repo `marvinperson11-debug/resumetailored`. Grant the new developer collaborator/admin access on GitHub.

### Services to transfer / grant access

| Service | What to transfer | Where |
|---|---|---|
| Railway | Project ownership / team member; all production env vars live here | https://railway.app/dashboard |
| Anthropic | Console org membership + API key | https://console.anthropic.com |
| Stripe | Account/team access; rotate keys; webhook secret at `/webhook` | https://dashboard.stripe.com |
| Resend | Account access + verified sending domain | https://resend.com |
| Netlify | Site/team access | https://app.netlify.com |
| Domain registrar / DNS | Account access for `resumetailored.com` DNS | (confirm provider with owner) |
| Google Analytics | Property access (`G-JWC76X5X68`) | https://analytics.google.com |
| Sentry | Org/project access (if used) | https://sentry.io |
| Adzuna / RapidAPI / USAJOBS | API accounts (if Job Finder keys are set) | respective dashboards |
| LinkedIn / Google OAuth apps | Developer app ownership (if social login is set up) | respective consoles |

### Billing

Each third-party service bills its own account (Anthropic usage, Stripe fees, Railway compute, Resend, ElevenLabs, job-provider APIs). Confirm the payment method on file for each with the owner and update it during transfer.

### To transfer ownership of services

Add the new developer to each dashboard's team/org, verify they can deploy (Railway) and see logs, then rotate every API key/secret and update them in the Railway env vars. Update the Stripe webhook endpoint if the domain changes, and re-verify the Resend sending domain if DNS moves.

---

*This document is a snapshot. `CLAUDE.md` in the repo root is the living, authoritative engineering reference — keep it updated as the source of truth.*
