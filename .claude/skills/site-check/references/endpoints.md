# ResumeTailor Endpoint Inventory

Routes defined in `server.js`. Use these for the `features` mode. Mark
key-dependent endpoints "skipped — no key" when the relevant env var is unset.

## Page / redirect routes (no key needed)

| Method | Path | Expect |
|---|---|---|
| GET | `/` , `/index.html` | 200 HTML |
| GET | `/dashboard`, `/login`, `/signup` | 200 (serves app.html) |
| GET | `/app` | 301 → `/dashboard` |
| GET | `/about` | 301 → `/how-it-works` |
| GET | `/blog` | 200 (blog index) |

## API — safe to test without external keys

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | liveness check |
| GET | `/api/status` | config/status summary |
| GET | `/api/auth/me` | returns 401 without a valid token (expected) |
| GET | `/api/forum` | list forum posts |

Example:
```bash
curl -s localhost:3000/api/health
curl -s localhost:3000/api/status
```

## API — needs ANTHROPIC_API_KEY

| Method | Path | Body sketch |
|---|---|---|
| POST | `/api/tools/extract-keywords` | `{ jobDescription }` — calls Claude, so needs the key |
| POST | `/api/ats-scan` | `{ resumeText, jobDescription }` |
| POST | `/api/tailor` | `{ email, resumeText, jobDescription }` (free-tier gated by IP) |
| POST | `/api/translate-resume` | `{ resumeText, targetLang }` |
| POST | `/api/optimize-linkedin` | `{ ... }` |
| POST | `/api/fetch-job-url` | `{ url }` (also needs outbound network) |
| GET | `/api/test-ai` | direct Claude connectivity probe |

## API — needs STRIPE_* keys

| Method | Path | Notes |
|---|---|---|
| POST | `/api/subscribe` | returns Stripe Checkout URL ($19/mo) |
| POST | `/api/subscribe-lifetime` | $129 lifetime checkout |
| POST | `/webhook` | Stripe events; raw body; needs `STRIPE_WEBHOOK_SECRET` |

## API — needs RESEND_API_KEY (falls back to stdout if unset)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/forgot-password` | logs reset link to stdout without key |
| POST | `/api/contact` | support message; logs to stdout without key |

## Auth flow note

Sessions are UUID tokens (in-memory `sessions` Map). `GET /api/auth/me`
without a token returning 401 is correct behavior, not a failure.
