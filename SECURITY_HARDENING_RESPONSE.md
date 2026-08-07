# Security Hardening Pass — Response & Questions

Before writing code, I audited the current codebase against every item in the
request. Two things changed my plan from "implement everything verbatim in one
PR and auto-merge":

1. **A meaningful chunk of this already exists.** Re-implementing it would be
   wasted risk on a payments-handling production app.
2. **A handful of items don't match this app's actual architecture**, or need
   a decision/credential only you can provide. Implementing those *as literally
   worded* would either be impossible, or would break the site.

Everything else — the large majority of the list — I can build safely in one
PR. Details and two concrete questions are below.

## Already in place (verified in code, not assumed)

| Ask | Status |
|---|---|
| Stripe webhook signature verification | ✅ Already correct — `stripe.webhooks.constructEvent` on the raw body, `express.raw()` mounted ahead of `express.json()` specifically so this can't regress |
| Passwords hashed, never plaintext | ✅ bcrypt already in use (cost 10 — I'll raise to 12) |
| Rate limiting | ✅ Partially — 12 separate limiters already exist (tailoring, employer actions, job search, lead forms, share links, etc.) via `express-rate-limit`, plus a global 30/min floor on all of `/api/*`. **Gap:** login/signup have no *dedicated* stricter limiter — they only get the generic 30/min, not your requested 5/15min + lockout. |
| Cookie consent banner | ✅ Already exists (`public/cookie-consent.js`) |
| Privacy Policy / Terms of Service | ✅ Both already exist (`public/privacy.html`, `public/terms.html`) — I'll review and update them, not build from scratch |
| No hardcoded secrets | ✅ Spot-checked — every API key (Anthropic, Stripe, Adzuna, RapidAPI, LinkedIn, Google, ElevenLabs, Resend) is read from `process.env`, none are literals in the source |
| Never store raw card data | ✅ Already true — only `customer_id`/`subscription_id` are persisted, Stripe Checkout handles card entry off-platform |

## Gaps I'll fix as requested (no conflicts, implementing all of this)

- Dedicated login/signup rate limiter: 5 attempts / 15 min per IP, then a 1-hour lockout, 429 + `Retry-After`. Same treatment for password reset and the contact form.
- Password policy: min 8 chars + upper/lower/number/symbol, checked client- and server-side.
- **Have I Been Pwned check** — using the free, keyless k-anonymity range API (`api.pwnedpasswords.com/range/{5-char-prefix}`), so this needs no new credential. Fails open (network hiccup never blocks signup) and never sends the full password over the wire, only a truncated SHA-1 prefix.
- bcrypt cost 10 → 12.
- Security headers on every response: HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a CSP — **corrected** to this app's real external calls (see Question 1).
- HTTP → HTTPS redirect (Railway terminates TLS in front of the app; I'll add the redirect at the Express layer using `x-forwarded-proto`).
- CORS lockdown to `resumetailored.com` / `www.resumetailored.com` (currently wide open — this is a real gap).
- Input validation pass: every route param, query param, and body field gets an explicit check before touching the DB or disk; SQL injection isn't currently possible (every query already uses `db.prepare(...).run/get/all` with parameter binding, never string-built SQL) but I'll add a validation layer so malformed input fails with a clean 400 instead of reaching that far.
- File upload hardening: confirm PDF/DOCX-only + size caps are enforced server-side (not just accepted by the `<input accept>` attribute), randomize stored filenames, keep uploads outside any directly-browsable path.
- Employer Portal audit log: new `audit_log` table + write on every employer action (viewed candidate, sent message, downloaded CSV, posted/edited job).
- Heavier, separate rate limit on the candidate-list/search endpoints specifically, to blunt scraping.
- `GET /api/user/me/export` — full data export as JSON.
- `DELETE /api/user/me` — full account + associated data wipe (resumes, sites, sessions, saved jobs, etc.), with a confirmation step so a stolen bearer token can't silently nuke an account from one request.
- Scrub any password/token/API-key fields before they'd ever reach a log line.
- Tests for all of the above (rate limiting, validation, webhook verification, export/delete), following this repo's existing plain-Node `test/*.js` convention.
- Updated `.env.example` with every new variable.
- `TASK_SUMMARY.md` documenting the diff.

## Items that don't match the current architecture, or need your input

**1. Session cookies (`HttpOnly`, `Secure`, `SameSite=Strict`, rotation) — this app doesn't use cookie sessions.**
Auth here is a bearer-token model: a UUID `rt_token` issued at login, stored in
the browser's `localStorage`, sent as an `Authorization` header on every API
call (`public/app.html`, confirmed in `CLAUDE.md`). There is no session
cookie today. Switching to cookies would mean rewriting every API call's auth
plumbing across the SPA, the LinkedIn/Google OAuth handoff, and the personal
website preview iframe (which needs the token client-side, not cookie-only) —
a genuine architecture change, not a hardening tweak, and it would invalidate
every current user's session on deploy.
**What I'll do instead**, which gets you the real security property without
the rewrite: keep bearer tokens, but (a) shorten session lifetime to 24h with
sliding expiry, (b) regenerate the token on login (already true — a new UUID
is minted every login) and on password change, (c) add the same token
revocation to the new account-deletion endpoint. If you *do* want a real
migration to cookie-based sessions, that's a separate, larger project I'd want
to scope on its own — say the word and I'll write that plan up separately.

**2. CSP `connect-src` — the request lists `api.openai.com`, but this app calls Anthropic, not OpenAI.**
Per `CLAUDE.md` and the code, the AI provider is `claude-sonnet-4-6` via
`ANTHROPIC_API_KEY`. I'll write the CSP against what's actually called
(`api.anthropic.com`, `api.stripe.com`, and the job-search providers'
domains), not the OpenAI domain from the template — a CSP that references the
wrong host doesn't protect anything and won't cause the AI feature to fail
open either way (that call happens server-side, not from the browser), so
this is a low-risk correction, just flagging that I'm not implementing it
literally-as-worded.

**3. "SSL/TLS on all database connections" — there is no networked database.**
Persistence is a local SQLite file (`better-sqlite3`) on the Railway
filesystem/volume, not a Postgres/MySQL server reachable over the network —
there's no connection to encrypt. This item doesn't apply to the current
stack. If a move to a hosted database (e.g. Postgres) is something you want,
that's also a separate infra decision, not something I'd bundle into a
hardening PR unprompted.

**4. Encrypting resumes/emails/phone numbers at rest.**
This is a real, legitimate ask, but it's a bigger change than it sounds:
SQLite has no native column encryption, so "encrypt PII at rest" means
application-level envelope encryption (a master key in an env var, encrypt on
write / decrypt on read for every field that touches a resume or profile), a
migration to re-encrypt existing rows, and a story for what happens if the
key is ever rotated or lost (lost key = permanently unreadable resumes).
I don't want to make that key-management decision unilaterally on a
production app with live user data. **Question 2 below.**

**5. Automated daily backups, 7-day retention.**
This is an infrastructure/ops decision (where do backups go — a Railway
Volume snapshot, S3, something else — and who pays for the storage), not a
code change I can make unilaterally. I can write the backup *script* (a
`sqlite3 .backup` dump on a schedule, matching the existing `career-cron.js`
in-process scheduler pattern already in this codebase) as part of this PR,
but actually wiring it to an off-box destination needs a target and
credentials from you.

**6. Sentry integration.**
I can wire the SDK, add `SENTRY_DSN` to `.env.example`, and make sure it
scrubs passwords/tokens/keys before any event is sent (matching your
requirement) — but it does nothing without a real DSN, which means creating a
Sentry account/project. I'll ship it wired-but-inert (silently disabled when
`SENTRY_DSN` is unset, same pattern this codebase already uses for every
other optional integration) so it activates the moment you add the key, with
no separate deploy needed.

**7. Cloudflare in front of Railway — already true.**
This one isn't a gap: `CLAUDE.md` and `server.js` both already document
Cloudflare sitting in front of the Railway deployment (it's actually the
reason a caching bug I fixed earlier this session existed at all — Cloudflare
overrides some origin cache headers). Nothing to add here.

**8. RBAC "job-seeker / employer / admin".**
Job-seeker vs. employer separation already exists and is enforced
(`isEmployer` gating on every `/api/employer/*` route). A formal "admin"
*role* doesn't currently exist as a per-user DB flag — there's a single
shared `ADMIN_SECRET` env-var passphrase used for two owner-only maintenance
routes (broadcast email, user list export). Building out real per-user admin
accounts (a `role` column, an admin login, an admin UI) is more than
"strict role separation" — it's a new feature. I'll harden what exists
(rate-limit + audit-log the admin routes, since they currently aren't
logged), but I'm not going to invent a new admin-account system inside a
security PR without knowing what you actually want an admin to be able to do.

## Two questions I need answered before I touch anything

**Q1 — PII encryption at rest (item 4 above):** do you want me to implement
application-level envelope encryption for resume/profile text this round
(with the key-loss tradeoff that implies), or hold that as a separate,
carefully-scoped follow-up? I'd lean toward the latter given the blast radius
of getting key management wrong on live data, but it's your call.

**Q2 — Auto-merge.** There is currently no CI workflow in this repo at all
(no `.github/workflows`) — so "auto-merge once CI is green" has nothing to
gate on right now. I can add a workflow that runs the existing `test/*.js`
suite on every PR, but that suite doesn't (and can't) verify things like "the
new CSP doesn't silently break Stripe Checkout's JS" or "the login rate
limiter doesn't lock out real users" — that needs a human looking at a
staging/preview deploy. Given this PR touches auth, payments headers, and
CORS on a live production app, my plan is: build everything in one PR as
requested, verify it locally exactly as thoroughly as every change this
session (start the server, exercise the changed endpoints, screenshot where
relevant), open the PR — and then **ask you to confirm before I merge it**,
rather than auto-merging. If you'd rather I merge automatically once the test
suite is green regardless, tell me and I will — I just want that to be an
explicit choice, not a default, on a change this size.

---

Once you've answered Q1 and Q2 (or told me to just use my judgment on both), I'll implement the full scope above in one PR.
