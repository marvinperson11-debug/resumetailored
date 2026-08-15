# Employer Portal Access — Rule Change

**Date:** 2026-08-14 · **Author:** Claude Code

Resolves the D1/D2 open question from `docs/MOBILE_NAV_LOGIN_FLOW.md`. Decision from the
account owner: **keep the free employer tier open to everyone; there is no `blocked_pro`.**

## New rule

- **Anyone** can create a **free employer account** and get **2 lifetime job posts** — brand-new
  visitors, free users, **job-seeker Pro subscribers, and Lifetime subscribers alike**. Same 2
  free posts for everyone.
- The only thing behind a paywall is the **paid employer features** (Pro $49/mo, Scale
  $199/mo): unlimited jobs, all AI matches, drag-and-drop pipeline, team seats, screener,
  analytics, API. This is independent of any job-seeker plan the user holds.
- The previous **block on job-seeker Pro/Lifetime subscribers creating an employer account is
  removed.**

## Changes made

- **`server.js`** — `employerPortalAccess()` no longer returns `blocked_pro`; it returns
  `full` (owner/comp, employer plan, or an existing employer account) or `onboard` (everyone
  else, who may create a free employer account). Removed the `blocked_pro` guard on
  `POST /api/employer/profile`.
- **`public/employer.html`** — removed the "separate product" (`nvBlocked`) screen and its
  boot branch; a signed-in user with no employer account now goes straight to the setup /
  onboarding flow.
- **`test/employer-portal-routes.js`** — the access-model test now asserts a job-seeker Pro
  subscriber gets `onboard` and **can** create a free employer account (200), not a 402.

The `/for-employers` landing page and the login chooser from the previous change are unchanged.

## Note

Stripe price IDs for the employer plans are now set in Railway (per the owner), so employer
Pro/Scale checkout is live. No code change needed for that.

## Open questions

None — the earlier ambiguity is resolved by this decision.
