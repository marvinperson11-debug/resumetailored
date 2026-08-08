# Login page + post-login redirect — Task Summary

Date: 2026-08-08. Branch: `claude/free-tools-page-redesign-6h2rab`.
Fixes the site-wide bug where "Log in" dropped users into the dashboard app and
never returned them to where they started.

---

## Root cause
`/login` and `/signup` both served `app.html` (the dashboard SPA), which forces
an auth **modal**. So every "Log in" CTA landed the user in the app, not on a
login page, and there was no redirect-back.

## What shipped
1. **Dedicated login page** — `public/login.html` (served at `/login` and
   `/signup`; server change in `server.js`). Email login + signup, Continue with
   Google, Continue with LinkedIn (each hidden unless the server reports it
   configured), forgot-password, and an already-logged-in short-circuit.
2. **Reads `?redirect=` and returns the user there.** A shared, unit-tested
   helper (`public/login-redirect.js`) sanitizes the target to a **same-origin
   absolute path** (rejects `//evil`, `https://…`, `javascript:`, and `/login`
   /`/signup` loops), with a same-origin `document.referrer` fallback, else
   `/dashboard`.
   - **Email** login/signup → navigates straight to the target.
   - **Google / LinkedIn** → the callbacks hard-redirect to `/dashboard?…_login=<handoff>`,
     so the page stashes the target in `localStorage.rt_post_login`; after
     `app.html` exchanges the handoff and signs in, `_consumePostLogin()` sends
     the user to the target (default `/dashboard`).
3. **Every "Log in" CTA now points to `/login?redirect=<current path>`:**
   - `site-nav.js` (the nav injected on **every** marketing / SEO / blog / tool
     page — hundreds of pages, one change) — computed from `location.pathname`.
   - Homepage nav, desktop + mobile (`index.html`) and the Chinese homepage
     (`zh/index.html`).
   - The Job Tracker's logged-out CTA (`job-tracker.js`).
4. `login-redirect.js` + `job-tracker.js` added to the asset-version map for
   cache-busting.

## Scope decision
Only **login/sign-up** CTAs were repointed. Product CTAs ("Tailor My Resume
Free →", "Start Free") still go to `/dashboard` — they start the app, they aren't
a login prompt. The Employer Portal has its own recruiter sign-in (separate
product) and was left alone.

## Tests — `test/login-redirect.js`
- Unit-tests the sanitizer (open-redirect / loop / cross-origin protection,
  hyphen + query paths kept) — same code the browser runs.
- Boots the app to prove `/login` and `/signup` now serve the **login page**
  (not the dashboard) and that email signup/login still return a session.
- Updated `test/html-asset-versioning.js` for the new `/login` content.
- **Full suite: all 30 test files pass locally.**

## Verified vs. not
- Route change, sanitizer, email login, versioning: **verified locally**.
- The **OAuth round-trip** (Google/LinkedIn → callback → `rt_post_login`) can't
  be exercised here (needs real OAuth keys + a browser). The logic is wired and
  the sanitizer is tested; recommend a click-through with keys on staging.
  Manual test matrix to run there: log out → from `/job-tracker`, `/score`,
  `/pro-tools`, `/`, and a blog post, click "Log in" → land on `/login` → log in
  (email, then Google, then LinkedIn) → land back on the origin page.
