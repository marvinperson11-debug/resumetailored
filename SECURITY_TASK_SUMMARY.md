# Security Hardening — Task Summary

Single PR, as requested. Everything below is implemented, tested locally, and
covered by an automated test suite that now also runs in CI on every PR (new
this round — see the "CI" section). `SECURITY_HARDENING_RESPONSE.md` is the
pre-implementation audit + the two questions asked before writing any code;
this document is the completion summary.

---

## New files

- **`security.js`** — pure security-logic core (password policy, Have I Been
  Pwned check, login-lockout tracker, log/error scrubbing, CORS whitelist,
  CSP builder, HTML escaping, timing-safe string compare). No Express, no
  direct DB access — mirrors the existing `career-hub.js`/`employer-hub.js`
  split so it's independently unit-testable.
- **`test/security.js`** — 30 pure unit tests for everything in `security.js`
  (no server boot, no network — HIBP is tested against a fake fetch).
- **`test/security-routes.js`** — boots the real app and drives the new
  surface end to end: headers, CORS, password policy, the login lockout
  (deliberately does NOT disable rate limiting — that's the one thing this
  file exists to exercise for real), the admin-secret guard, webhook
  signature rejection, and account export/deletion.
- **`.github/workflows/tests.yml`** — the first CI in this repo. Runs every
  `test/*.js` file on every PR into `main` and on every push to `main`.
- **`SECURITY_HARDENING_RESPONSE.md`** — the pre-implementation audit and the
  two questions you answered before this work started.

## Changed files

`server.js`, `package.json`/`package-lock.json` (added `@sentry/node`),
`.env.example` (documented the two new variables).

---

## Authentication & sessions

- **Login/signup/password-reset/contact-form rate limiting**: a dedicated
  `authRateLimiter` (20 req/15min, on top of the existing global 30/min) plus
  a purpose-built **failed-attempt lockout** (`security.js`'s
  `createLockoutTracker`) — 5 *failed* attempts per IP in 15 minutes trips a
  1-hour lockout, returned as `429` with a `Retry-After` header. This tracks
  failures specifically, not raw request volume, so a mistyped password once
  or twice in normal use never counts the same as a credential-stuffing
  attempt would. A successful login clears the tracker for that IP.
- **Session ID regeneration on login**: already true before this PR (a fresh
  UUID session token is minted on every login) — verified, not re-built.
  Password reset already revoked every existing session for that account;
  unchanged, verified.
- **Password policy**: min 8 characters + upper/lower/number/symbol,
  enforced on signup and password reset.
- **Have I Been Pwned check**: the free, keyless k-anonymity range API
  (`api.pwnedpasswords.com/range/{5-char-SHA1-prefix}`) — only a truncated
  hash prefix ever leaves the server, never the password or its full hash.
  Fails **open**: a network hiccup never blocks a signup, only a confirmed
  match against the real breach corpus does. Verified live in
  `test/security-routes.js` (it caught a genuinely breached test password on
  the first pass — see the commit history for that one).
- **bcrypt cost raised from 10 to 12.**
- **Session cookies (`HttpOnly`/`Secure`/`SameSite=Strict`) were NOT
  implemented as literally worded** — this app authenticates with a bearer
  token in `localStorage`, not cookies, and switching would be an
  architecture rewrite (every API call, the LinkedIn/Google OAuth handoff,
  the site-editor iframe) that would also invalidate every current session on
  deploy. Flagged in `SECURITY_HARDENING_RESPONSE.md` before starting; you
  confirmed skipping the cookie migration for now.

## Security headers (every response)

`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, and a `Content-Security-Policy`.

Two deliberate corrections from the literal request, both verified live with
Playwright before shipping (not guessed):

- **`X-Frame-Options: SAMEORIGIN`, not `DENY`.** The Website Creator's own
  editor canvas iframes `/api/personal-site/preview` on this same origin —
  `DENY` blocks ALL framing, same-origin included, which would have taken
  the entire site editor down. `SAMEORIGIN` still stops the thing this
  header exists for (a third-party site framing this one for clickjacking).
- **The CSP is built from what the app's pages actually load, not the
  template.** The original ask's `connect-src` listed `api.openai.com`; this
  app calls Anthropic. More importantly, the literal template CSP would have
  broken **Google Analytics, Google AdSense (real ad revenue), the
  ElevenLabs browser-direct voice API, and the `/preview` page's
  esm.sh-hosted React/Remotion modules** — none of which were mentioned in
  the request but all of which are live on the site today. Verified with a
  headless-browser console check across `/`, `/dashboard`, `/how-it-works`,
  `/score`, `/employer`, and `/preview`: **zero CSP violations** on any of
  them with the shipped policy.

## HTTPS & CORS

- HTTP→HTTPS redirect via `x-forwarded-proto` (Railway terminates TLS and
  forwards this header; a bare local request never sets it, so this never
  fires against `curl http://localhost` or the test suite).
- CORS changed from a bare `cors()` (reflects any origin) to an explicit
  whitelist: `resumetailored.com`, `www.resumetailored.com`, any
  `*.resumetailored.com` subdomain (personal sites and the employer
  subdomain routing already live on that pattern), and `localhost` for local
  dev. No wildcard in production.

## Stripe & payments

- Webhook signature verification was **already correct** before this PR
  (`stripe.webhooks.constructEvent` on the raw body) — verified, not
  rebuilt, and now has a regression test (`test/security-routes.js`: an
  unsigned webhook POST returns 400).
- Never stored raw card data before this PR either — only `customer_id`
  /`subscription_id`. Verified, unchanged.
- **New**: account deletion (below) now best-effort cancels any live Stripe
  subscription tied to the account, so deleting an account also stops
  billing it — there was no other way to do that anywhere in the app before
  this PR (no self-service "cancel subscription" existed).

## Input validation & XSS

- Auth endpoints, the contact form, and `/api/tailor` now validate types and
  lengths server-side (not just presence), including a length cap on
  `/api/tailor`'s resume/job-posting text — a real cost control, since every
  character is billed Anthropic API usage.
- Fixed **three unescaped-HTML-in-email** spots found while working through
  the employer routes (the contact form, the employer→candidate contact
  request, and the employer→candidate message) — user-supplied text was
  interpolated into an HTML email body with no escaping. Added a shared
  `escapeHtml()` in `security.js`, used at all three, plus stripped
  `\r\n` from the contact form's subject line (header-injection defense).
- SQL injection was already not possible anywhere in `server.js` — every
  query already uses `db.prepare(...).run/get/all` with bound parameters,
  never string-built SQL. Verified by inspection, not re-built.

## File uploads

Verified, no code changes needed: the resume-upload path (`multer`,
memory storage, PDF/DOC/DOCX/TXT only, 10MB cap) never touches disk. The
personal-site media upload path already streams to disk with **randomized
filenames** (`up_<timestamp>_<12 random hex chars>`, no extension, no
original filename retained) and is served through a DB-id-keyed `/media/:id`
route rather than any direct/guessable filesystem path — so "random
filenames, no direct URL exposure" was already true.

## Employer Portal: RBAC & audit log

- Job-seeker vs. employer separation was already enforced (`isEmployer`
  gating on every `/api/employer/*` route). A formal per-user "admin" *role*
  doesn't exist — the two owner-only routes use a shared `ADMIN_SECRET`
  passphrase, which this PR hardened (below) rather than replacing with a
  new admin-account system, which would be a feature addition, not
  hardening, and wasn't specified.
- **New `audit_log` table**, written on: viewing a candidate's full profile,
  contacting a candidate, sending a candidate a message, downloading the
  applicants CSV, posting a job, editing a job, and both admin routes.
  Deliberately survives account deletion (a security/audit trail outliving
  the account it describes is standard practice; there's no foreign key
  tying it to `users`).
- **Scraping protection**: the candidate-list search endpoint is now capped
  at 30 req/min and the individual-profile endpoint at 60 req/min per IP —
  tighter than the shared 30/min global floor, tuned so normal recruiter
  browsing (search, open a handful of profiles) stays well under either cap
  while bulk enumeration of the whole candidate database does not.

## Admin routes

- Timing-safe comparison (`crypto.timingSafeEqual`) instead of `===` for
  `ADMIN_SECRET`, so a wrong guess can't be narrowed down via response-time
  differences.
- Same lockout tracker as login/signup (5 wrong attempts/15min → 1hr
  lockout) — previously unlimited beyond the generic 30/min floor.
- Both admin routes now write to `audit_log`.

## Data export & account deletion

- **`GET /api/user/me/export`** — every table that stores rows under the
  signed-in account's email (an explicit, reviewable list in `server.js`,
  not schema introspection), plus both sides of shared employer↔candidate
  tables (messages, interviews, contact requests, job applications) labeled
  by role. Never includes the password hash.
- **`DELETE /api/user/me`** — requires re-entering the account's password
  (a stolen bearer token alone can't trigger the one unrecoverable
  operation in the app), then: best-effort cancels any live Stripe
  subscription, unlinks on-disk media/video files, deletes every row across
  every table above inside one transaction, and revokes all sessions +
  reset tokens. Owner gets a notification with any Stripe-cancellation
  warning surfaced (rather than silently failing open on the billing side).

## Monitoring

- **Sentry**: wired via `@sentry/node`, fully inert (server boots and runs
  identically) unless `SENTRY_DSN` is set. `beforeSend` and a new global
  Express error handler (this repo had none before) scrub anything
  secret-shaped before an event leaves the process, on top of the
  `scrubForLog()` pass already applied to audit-log metadata.
- **>100 failed logins in 10 minutes** → one owner-email alert per incident
  (a global, site-wide counter — not per-IP, since a distributed
  credential-stuffing run spreads across many IPs each individually under
  its own lockout threshold).
- Passwords/tokens/`req.body` were already never logged anywhere in
  `server.js` — verified by grep, not assumed. `scrubForLog()` adds
  defense-in-depth for the two new places that do log structured data
  (audit-log `meta`, Sentry events).

## Privacy & compliance

Privacy Policy, Terms of Service, and a cookie-consent banner already
existed (`public/privacy.html`, `public/terms.html`, `public/cookie-consent.js`)
— verified, not rebuilt. The new account export/deletion endpoints are the
compliance-relevant additions this round.

## Explicitly out of scope this round (by your answer to Q1/Q2 in `SECURITY_HARDENING_RESPONSE.md`)

- **PII encryption at rest** — skipped, to be scoped as its own follow-up
  given the key-management tradeoffs involved.
- **Cloudflare in front of Railway** — already true, nothing to add.
- **Automated offsite backups** — needs a storage destination/credentials
  decision; not built this round.
- **"SSL/TLS on all database connections"** — doesn't apply; persistence is
  a local SQLite file, not a networked database.

---

## Findings from the self security-review (before merge, not by you)

Since you don't review code yourself, this PR went through an automated
security-review pass (identification → independent false-positive filtering
per finding → only findings scoring ≥8/10 confidence survive) before being
opened. Two real gaps were found and fixed, both in `DELETE /api/user/me`'s
completeness — not injection/auth-bypass bugs, but the deletion endpoint not
actually deleting everything its own "all associated data" claim promised:

1. **Shared resume links (`shared_resumes`, the `/r/:slug` pages) survived
   account deletion.** That table predates any account link — creating a
   share never required signing in — so it had no owner column at all, and
   couldn't be included in the original export/deletion table lists. A
   deleted account's shared résumé (name, full text, optional photo) would
   have stayed live at its URL forever. Fixed: added a nullable
   `owner_email` column (populated from the session when one exists;
   anonymous shares still have nowhere to attribute to, an accepted,
   separate limitation), wired into both the export and the deletion
   transaction.
2. **Deleted employers' job postings kept appearing in Job Finder search
   results.** Every posting is mirrored into a separate `job_feed` table
   (what the public search actually reads); the single-job-delete and
   close-job paths both already clean up that mirror
   (`_removeEmployerJobFromFeed`), but the new bulk account-deletion path
   didn't call it before deleting `job_postings` — leaving the mirrored
   copy orphaned and still served. Fixed: the deletion transaction now
   purges each posting's `job_feed` mirror first.

Both are covered by new assertions in `test/security-routes.js` (seeded
`shared_resumes`/`job_postings`/`job_feed` rows, verified gone after
deletion) so a regression here fails CI, not just a future review pass.

## CI

`.github/workflows/tests.yml` — the first CI this repo has had. Runs every
file in `test/*.js` on every PR into `main`. This PR's merge is gated on
that workflow passing.

## Verification performed before merge

- All 30 pre-existing test files: **zero regressions**, all still pass
  (confirmed across repeated full-suite runs, both before and after the
  self-review fixes above).
- Both new test files (66 assertions combined): all pass.
- Live headless-browser check across 6 representative pages: zero CSP
  console violations.
- Manual server boot + curl check that every new header, CORS behavior,
  and the login lockout actually work end to end, not just in the test
  harness.
- An automated security-review pass (see above) on the complete diff, with
  independent false-positive filtering on every candidate finding.
