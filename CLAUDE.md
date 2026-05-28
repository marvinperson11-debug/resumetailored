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
OWNER_EMAIL           # optional — where support messages go (defaults to marvinperson11@gmail.com)
```

## Deployment

Deployed on Railway. `railway.json` configures the build (Nixpacks) and start command. All env vars must be added in the Railway dashboard. The Stripe webhook endpoint URL is `https://<your-railway-url>/webhook`.

To switch from Stripe test mode to live mode: replace all three Stripe env vars with live keys and create a new product/price in Stripe live mode.
