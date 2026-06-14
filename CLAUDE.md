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

There is no build step. The frontend is plain HTML/CSS/JS with no framework. `app.html` is a single-page app where tabs are shown/hidden via `showTab()` without any routing.

## In-memory state (critical limitation)

All server state is stored in JavaScript `Map` objects in `server.js` and resets on every server restart:

| Map | What it tracks |
|---|---|
| `usageStore` | Free-tier usage counts, keyed by `${ip}_${date}` |
| `subscribers` | Active Stripe subscribers, keyed by email |
| `users` | User accounts (email, username, SHA-256 password hash) |
| `sessions` | Auth tokens (UUID → email) |
| `resetTokens` | Password reset tokens with 1-hour TTL |
| `checkIns` | Career check-in form data by email |
| `forumPosts` | Community forum posts and replies |

This is intentional for MVP. Adding a database (SQLite or Postgres on Railway) is the next major infrastructure step.

## Auth flow

Sessions use UUID tokens stored in the browser's `localStorage` (`rt_token`, `rt_email`, `rt_username`). The server validates tokens via `GET /api/auth/me`. `app.html` forces the auth modal on load if no valid token exists.

Passwords are hashed with SHA-256 using a static salt (`rta_salt_2026_` prefix). This is not bcrypt — do not treat it as production-grade.

## Free tier gating

`/api/tailor` checks two things before calling Claude:
1. Is the `email` parameter in an active Stripe subscription? (`isSubscriber()`)
2. If not subscribed, has the IP used its 1 free tailoring today? (`hasFreeTierLeft()`)

Free usage is tracked by `${ip}_${today}` key in `usageStore`. This resets naturally at midnight because the date string changes.

## Stripe integration

- Checkout is initiated via `POST /api/subscribe` → returns a Stripe Checkout URL.
- `POST /webhook` receives `checkout.session.completed` (adds to `subscribers`) and `customer.subscription.deleted` (removes from `subscribers`).
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
STRIPE_PRICE_ID       # Stripe Price ID (price_...)
PORT                  # defaults to 3000
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
