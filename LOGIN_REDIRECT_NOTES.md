# Login page + redirect — build notes & decisions

Building in one PR. A couple of decisions worth flagging; no blockers.

## The root cause
There was **no dedicated login page**: `/login` and `/signup` both served
`app.html` (the dashboard SPA), which forces an auth **modal** on load. So every
"Log in" CTA that pointed at `/login` (or `/dashboard`) dropped the user into the
app — exactly the reported bug. Login methods that exist: **email/password,
Google OAuth, LinkedIn OAuth** (all wired in the app's modal today).

## What I'm building
1. **`public/login.html`** — a real, standalone login/sign-up page (cream/green,
   its own page, not a modal) with email login + signup, Continue with Google,
   and Continue with LinkedIn. It:
   - reads `?redirect=`, **sanitizes** it (must be a same-origin path starting
     with a single `/`, and never `/login` or `/signup` — no open-redirect, no
     loop), and falls back to the same-origin `document.referrer` path when no
     param is present (safety net for any CTA I don't reach), else `/dashboard`.
   - **email login/signup** → stores the session and navigates straight to the
     target.
   - already-logged-in visitors are bounced to the target immediately.
   - Google/LinkedIn hide themselves if the server reports them unconfigured
     (`/api/auth/google/status`, `/linkedin/status`).
2. **Server** (`server.js`): `/login` and `/signup` now serve `login.html`.
3. **Redirect survives OAuth without fragile server state.** The Google/LinkedIn
   callbacks hard-redirect to `/dashboard?..._login=<handoff>`. So before
   starting OAuth, the login page stores the target in `localStorage.rt_post_login`;
   after `app.html` exchanges the handoff and signs the user in, it consumes
   `rt_post_login` and navigates there (default `/dashboard`).
4. **CTAs repointed to `/login?redirect=<current path>`:**
   - `site-nav.js` "Log In" (the injected nav on every marketing/SEO/blog/tool
     page) — computed from `location.pathname` at click.
   - Homepage nav "Log In" (desktop + mobile) → `/login?redirect=/`.
   - `job-tracker.js` logged-out "Log in / Sign up" → `/login?redirect=<path>`.

## Scope decision — only *login* CTAs change
I'm repointing buttons whose purpose is **logging in / signing up**. The
"Tailor My Resume Free →" / "Start Free" product CTAs still go to `/dashboard`
(they start the app, they aren't a login prompt). Repointing those would be a
different behavior change than asked.

The 277 SEO pages carry a static `href="/login"` in their source nav, but
`site-nav.js` **replaces** that nav at runtime — so the rendered "Log In" comes
from `site-nav.js` (fixed centrally) — plus the referrer fallback covers the
static links if ever shown. The Employer Portal has its own recruiter sign-in
flow (separate product) and is out of scope.

## Testing
`test/login-redirect.js` will assert `/login` serves the login page (not the app)
and that email login returns a session; the redirect handling is client-side, so
I'll verify the sanitizer logic in the test and note the OAuth round-trip needs a
browser + keys (can't run here). Ship on green.
