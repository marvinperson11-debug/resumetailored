# ResumeTailored — Work Report

**Date:** 2026-08-14
**Author:** Claude Code
**Repo:** `marvinperson11-debug/resumetailored`

A summary of everything done in this session: LinkedIn marketing assets, a content
pack, a B2B "Teams" offer, a Terms-of-Service consistency fix, and a full
**Employer Portal v2.0** build. Three pull requests were opened and **all merged to
`main`**.

---

## At a glance

| # | Workstream | Deliverable | PR | Status |
|---|---|---|---|---|
| 1 | LinkedIn promo images | 5 branded PNGs + source | #377 | ✅ Merged |
| 2 | Social content pack | 3 personal + 3 business posts + 3 blogs + 3 employer posts | — | Delivered in chat |
| 3 | B2B "Teams" offer | Packaging, LinkedIn post, on-brand landing section | #377 | ✅ Merged |
| 4 | Terms-of-Service fix | Free-tier language aligned to "unlimited" | #378 | ✅ Merged |
| 5 | Employer Portal v2.0 | Tiers, lifetime cap, AI matching, DnD pipeline, billing, nurture, company pages | #379 | ✅ Merged |

---

## 1. LinkedIn promotional images (PR #377)

Five on-brand promo images spanning all four requested formats and four art
directions, built as pure HTML/CSS and rendered to PNG at 2× with the
pre-installed Chromium (no external image API).

| File (`assets/banners/linkedin/`) | Format | Style |
|---|---|---|
| `square-bold-1080x1080.png` | Feed post 1:1 | Bold typography |
| `square-editorial-1080x1080.png` | Feed post 1:1 | Editorial minimalist |
| `link-post-1200x627.png` | Link-share card | Gradient + product mock |
| `profile-banner-1584x396.png` | Profile cover | Editorial (avatar-zone-safe) |
| `story-1080x1920.png` | Story / vertical | Product showcase |

- **Brand:** cream `#FAF7F0` + forest green `#1F5C3D`, Fraunces serif + Inter.
- **Copy:** free & unlimited, powered by Claude, ATS-ready, $19.00/mo (vs a struck-through $29).
- **Reproducible:** one `.html` per banner + shared `_brand.css`; `node assets/banners/linkedin/shoot.js` re-renders all five.
- A layering bug (paper-grain washing out the logo) was found and fixed during visual review.

## 2. Social content pack (chat)

Written copy in ResumeTailored's voice, consistent with current positioning:

- **3 personal-page posts** (founder voice): the "why", the ATS insight, a milestone.
- **3 business-page posts**: Career Hub launch, Resume Video + Personal Website, free-unlimited + Claude quality.
- **3 blog articles**: "Why your resume gets rejected before a human reads it", "Tailor your resume in 10 minutes", "Free vs paid AI resume tools in 2026".
- **3 employer-targeted posts**: outplacement (HR), recruiter self-interest, candidate experience / employer brand.

_(These were delivered in the conversation, not committed to the repo.)_

## 3. B2B "ResumeTailored for Teams" offer (PR #377)

A hiring-side / outplacement B2B offer, since the base product is job-seeker-facing.

- **Packaging (suggested pricing):**
  - **Team** — $15/seat/mo (annual, min 3 seats): Pro for everyone, admin dashboard, consolidated billing.
  - **Outplacement** ⭐ — $69/departing employee (one-time, 6 months Pro), co-branded, volume tiers.
  - **Enterprise & Partners** — custom: SSO, white-label, API, SLA.
- **Matching LinkedIn announcement post.**
- **Landing section** — `assets/banners/linkedin/teams-landing.html`, an on-brand, drop-in `/teams` section (hero, 3 pricing cards, value strip, CTA), rendered and verified.
- **Note:** a real Teams product needs an admin dashboard + bulk seats + consolidated billing before self-serve; recommended running it sales-led (CTAs are "Book a call") until then.

## 4. Terms-of-Service consistency fix (PR #378)

The homepage advertised **"Unlimited free tailoring · no daily limit,"** but the Terms
(and two SEO pages) still described the pre-2026 model (1 tailoring/cover/ATS/LinkedIn
per calendar day, per IP). The Terms were the stale outlier and were brought in line
with the actual product.

- `public/terms.html` — §4 rewritten: unlimited use, free account required to tailor,
  rate limiting / anti-abuse as the guardrail, small export watermark + limited
  templates. Two "free-tier limits" references reworded to "rate limits / usage restrictions."
- `public/ai-resume-tailor.html` and `public/jobscan-alternative.html` — "one tailoring every day" → "unlimited tailoring."
- Copy-only; no server/app/test changes.

---

## 5. Employer Portal v2.0 (PR #379)

The largest workstream. The v2 spec was written for a Next.js + Prisma + PostgreSQL +
NextAuth + Redis stack — **none of which exists in this repo** (it's Express + SQLite +
vanilla JS). Rather than fork a second app, v2 was **adapted onto the real stack and
built on the existing employer portal** already present in `server.js` / `public/employer.html`.
Rationale and options are documented in `docs/EMPLOYER_PORTAL_V2.md`.

### Requirements → implementation (all delivered)

- **Free tier: 2 job posts EVER (lifetime).** Enforced against a monotonic
  `jobs_posted_lifetime` counter on the employer profile — incremented on every
  successful create, **never decremented**, so archiving, hiring, or deleting a
  posting can't free a slot. The 3rd post requires Pro.
- **Pro $49/mo** — unlimited jobs, AI candidate matching, 5 team seats, screener
  questions, analytics.
- **Scale $199/mo** — API access + unlimited everything.
- **AI match scoring** — each applicant's resume is scored against the job via Claude
  (haiku), cached per (job, candidate). The ranked list is **gated: top 3 shown free,
  the rest returned locked** with PII stripped server-side and only a score band exposed.
- **Drag-and-drop pipeline** — New → Reviewed → Interview → Hired → Rejected (HTML5 DnD;
  Pro-gated, free sees a read-only board).
- **In-app messaging** — the portal's existing messaging was reused.
- **Company profile pages** — public, indexable `/company/:slug` (company header + active
  roles + growth-loop footer).
- **Stripe billing** — tier-aware checkout (`plan=pro|scale`); webhook records the tier.
- **Free→Pro email sequence** — a 3-step nurture (day 0 / 3 / 7).

### How it was built (phases, each its own commit)

1. **Tiers + lifetime cap + billing backbone** — `EMPLOYER_TIERS`, `canPostJob()`,
   `resolveEmployerTier()`, migrations, `employerTier()`/`lifetimeJobsPosted()`,
   `/api/employer/status`, tier-aware Stripe checkout + webhook.
2. **AI candidate matching** — `buildApplicantMatchPrompt()` + `validateMatchResult()`,
   `GET/POST /api/employer/jobs/:id/ai-matches` (Claude scoring, cache, `applyMatchGate`).
3. **Frontend** — drag-and-drop Kanban board, AI-match blur with upgrade CTA, three-tier
   billing card, lifetime-usage copy.
4. **Free→Pro nurture** — pure `nurtureStepDue()` pacing + `scripts/employer-nurture.js`
   (idempotent daily sender), wired into `career-cron.js`.
5. **Public company pages** — `slugifyCompany()`, slug column + backfill,
   `GET /company/:slug` renderer, Settings link.

### Files changed

- **`employer-hub.js`** (pure core): tiers, `canPostJob`, `resolveEmployerTier`,
  `applyMatchGate`, `validateScreenerQuestions`, match prompt/validator,
  `buildEmployerNurtureEmail`, `nurtureStepDue`, `slugifyCompany`.
- **`server.js`**: migrations (`jobs_posted_lifetime`, `slug`, subscriber `tier`/`status`,
  `screener_questions`), new tables (`employer_ai_matches`, `employer_nurture`),
  tier helpers, lifetime-cap gate on job create, AI-match routes, tier-aware Stripe
  checkout + webhook, `GET /company/:slug`.
- **`public/employer.html`**: Kanban pipeline, AI-match view, tiered billing UI, public-page link.
- **`career-cron.js`**, **`scripts/employer-nurture.js`**, **`package.json`** (`npm run employer:nurture`).

### Testing

- `test/employer-hub.js` — pure-core checks for tiers, lifetime cap, match gate, screener,
  nurture pacing, and slugs.
- `test/employer-portal-routes.js` — boots the real app on a temp DB; lifetime semantics,
  the AI-match gate (seeded cache, **no LLM calls**), and the public company page.
- Full `test/*.js` suite (39 files) passing.
- **Verified visually** by booting the app with seeded data and screenshotting: the Kanban
  pipeline, the free-tier AI-match blur, and the public company page.

### Config to go live (all optional; features degrade gracefully)

- `STRIPE_EMPLOYER_PRO_PRICE_ID` / `STRIPE_EMPLOYER_SCALE_PRICE_ID` — the $49 and $199
  recurring Stripe prices (Pro falls back to the existing `STRIPE_EMPLOYER_PRICE_ID`).
  See **Stripe employer plan setup** below for the actual IDs.
- `CAREER_CRON=on` + `EMPLOYER_NURTURE_HOUR_UTC` (default 15:00 UTC) to run nurture emails;
  `RESEND_API_KEY` to actually send.

---

## Stripe employer plan setup (price IDs)

The two employer plans are wired to these Stripe price IDs (provided 2026-08-14). They are
**deployment config, not code** — the app reads them from the environment, so they go in
Railway's Variables (Railway → the ResumeTailored web service → **Variables**), not in the repo.

| Variable | Value | Plan |
|---|---|---|
| `STRIPE_EMPLOYER_PRO_PRICE_ID` | `price_1U4QHkCgLyCpwXXjlHMDBmHq` | Pro — $49/mo |
| `STRIPE_EMPLOYER_SCALE_PRICE_ID` | `price_1U4QIgCgLyCpwXXjPy8UtUiS` | Scale — $199/mo |

**After saving** (which triggers a redeploy — expected):
- "Upgrade to Pro — $49/mo" uses `STRIPE_EMPLOYER_PRO_PRICE_ID`.
- "Upgrade to Scale — $199/mo" uses `STRIPE_EMPLOYER_SCALE_PRICE_ID`.
- The existing `/webhook` + `STRIPE_WEBHOOK_SECRET` record which tier was bought (`pro`/`scale`) — no new webhook setup needed.

**Two things to check:**
1. **Mode match** — these price IDs must be the same mode (live vs. test) as `STRIPE_SECRET_KEY`.
   A live checkout with a test price (or vice-versa) fails. For real billing, use **live** price
   IDs paired with a live secret key.
2. `STRIPE_EMPLOYER_PRICE_ID` (the old single-price var) is no longer required — the code falls
   back to it for Pro only if `STRIPE_EMPLOYER_PRO_PRICE_ID` is unset, and the explicit Pro var
   above takes precedence.

_Status: values provided; not yet applied to Railway. Setting Railway variables from this
session required an approval that wasn't available, so they need to be added in the Railway
dashboard (or re-run with the Railway integration approved)._

---

## Git / process notes

- Work landed across **PRs #377, #378, #379**, each opened as a draft, verified green on
  the Netlify deploy preview, and merged (squash) on your go-ahead.
- Each PR was auto-watched for CI/review activity; the only events were routine Netlify
  deploy-preview notifications (no failures).
- The pre-2026 employer schema already present in the repo was extended, not duplicated.

## Suggested follow-ups (not built)

- Commit the **social content pack** to the repo (e.g. `docs/marketing/content-pack.md`) if you want it version-controlled.
- Build the **Teams admin dashboard + bulk-seat provisioning + consolidated billing** to make the B2B offer self-serve.
- Add a **link from `/company/:slug` job cards to a real per-job apply view** (they currently link to `/employer`).
- Consider **team-seat invites UI** (the Pro/Scale seat limits exist in the model; the invite flow is not yet built).
