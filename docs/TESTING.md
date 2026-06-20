# Manual Test Checklist — AI & Stripe Flows

These flows require live API keys (`ANTHROPIC_API_KEY`, `STRIPE_*`) and so can't
be exercised from a keyless sandbox. Run them against a key-enabled environment —
ideally a Railway **staging** deploy, or locally with a `.env` and **Stripe test
mode** keys. Use Stripe **test mode** throughout so no real charges occur.

## 0. Setup

- [ ] `.env` populated: `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY` (test),
      `STRIPE_PUBLISHABLE_KEY` (test), `STRIPE_PRICE_ID` (test price),
      optionally `STRIPE_LIFETIME_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`.
- [ ] `npm install && npm start` — confirm no `STARTUP ERROR` lines for the keys.
- [ ] `curl -s localhost:3000/api/status` shows `stripe:true`, `stripePrice:true`.
- [ ] `curl -s localhost:3000/api/test-ai` returns a successful Claude response
      (probes raw connectivity to Anthropic).

## 1. AI — resume tailoring (`POST /api/tailor`)

- [ ] **Resume mode:** send `{ resume, jobPosting, mode:"resume" }` → returns a
      rewritten resume that mirrors the job's keywords; no fabricated experience.
- [ ] **Cover letter mode:** `mode:"cover_letter"` (no resume required) → returns
      a tailored cover letter.
- [ ] **Both mode:** `mode:"both"` → returns both.
- [ ] **Validation:** missing `jobPosting` → 400; bad `mode` → 400; `mode:"resume"`
      with no resume → 400.
- [ ] **Free-tier gate (not subscribed):** first call OK; second same-type call
      same day → `402 free_limit_reached`. Confirm `usage_store` row increments.
- [ ] **Chinese market:** paste a job URL/text from zhipin/liepin/zhaopin → output
      includes bilingual keyword handling.

## 2. AI — other endpoints

- [ ] `POST /api/ats-scan` `{ resumeText, jobDescription }` → 0–100 score + missing
      keywords + rewrite suggestions.
- [ ] `POST /api/tools/extract-keywords` `{ jobDescription }` → keyword list (200,
      not the "AI extraction failed" error you get without a key).
- [ ] `POST /api/translate-resume` `{ resumeText, targetLang }` → translated text.
- [ ] `POST /api/fetch-job-url` `{ url }` → extracted job description (needs
      outbound network too).

## 3. Stripe — monthly subscription

- [ ] `POST /api/subscribe` `{ email }` → returns a `url`. Open it.
- [ ] Pay with test card `4242 4242 4242 4242`, any future expiry/CVC/ZIP.
- [ ] Redirects to `/success.html?session_id=...`.
- [ ] **Webhook:** with Stripe CLI running
      `stripe listen --forward-to localhost:3000/webhook`, confirm
      `checkout.session.completed` is received and a `subscribers` row is inserted
      for that email (log line: `New monthly subscriber: <email>`).
- [ ] After activation, `/api/tailor` for that `email` bypasses the free-tier
      limit (unlimited).

## 4. Stripe — lifetime plan (if `STRIPE_LIFETIME_PRICE_ID` set)

- [ ] `POST /api/subscribe-lifetime` `{ email }` → returns a `url` (one-time
      payment mode). If the env var is unset, expect `503`.
- [ ] Complete test payment → `success.html?...&plan=lifetime`.
- [ ] Webhook stores subscriber with `customer_id = lifetime_<email>`.

## 5. Stripe — cancellation

- [ ] In the Stripe test dashboard, cancel the monthly subscription.
- [ ] `customer.subscription.deleted` webhook fires → `subscribers` row removed
      (log: `Removed subscriber with customer_id: ...`).
- [ ] A **lifetime** subscriber is NOT removed by any subscription-deletion event
      (sentinel `customer_id`).

## 6. Signature security

- [ ] POST to `/webhook` with a bogus/missing `stripe-signature` → `400 Webhook
      Error` (event rejected). Confirms `STRIPE_WEBHOOK_SECRET` verification works.

## Notes

- `/api/auth/me` returning 401 without a token is correct, not a failure.
- Switching to live mode: replace all Stripe keys with live values and create a
  new product/price in Stripe live mode (see CLAUDE.md → Deployment).
