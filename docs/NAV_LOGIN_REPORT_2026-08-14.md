# Mobile Nav + Login Flow — Work Report

**Date:** 2026-08-14 · **Author:** Claude Code
**PR:** #381 (squash-merged to `main`, commit `50aeadb`) · **Status:** ✅ Shipped, CI green

Report of the mobile navigation + login-flow work (the 7-point request), plus the two
small items that rode along on the same branch.

---

## What was requested → what was built

| # | Request | Result |
|---|---|---|
| 1 | Change the mobile "Dashboard" button to "Login" | ✅ Mobile menu now shows **"Login"** and no longer auto-swaps to "Dashboard" when signed in |
| 2 | "Login" shows two options (Job Seeker / Employer) | ✅ **Login chooser modal** — "Login as Job Seeker" and "Login as Employer" |
| 3 | Owner can log into both sides with one email (testing) | ✅ Owner gets `full` access; the employer gate never blocks the owner |
| 4 | Employer-plan = whole site; block Pro subs from the portal | ✅ Server-side access gate (below); job-seeker Pro/Lifetime → "separate product" screen |
| 5 | "For Employers" (logged out) → landing page, not the portal | ✅ New **`/for-employers`** page with "Create Employer Account" CTA |
| 6 | Remove "Templates" from the mobile menu | ✅ Removed |
| 7 | Only Free Tools + "Tailor My Resume Free" are direct actions | ✅ Others link to info pages |

## The access model (`employerPortalAccess(email)`)

Enforced server-side (on `/api/employer/status` and `POST /api/employer/profile`), mirrored in
the client so the UX matches:

| Who | Result |
|---|---|
| Owner / comped accounts | **`full`** — both the employer portal and job-seeker tools |
| Employer plan (Pro/Scale) or an existing employer account | **`full`** |
| Job-seeker **Pro** (monthly) or **Lifetime** subscriber, no employer account | **`blocked_pro`** — shown a "the employer portal is a separate product" screen with a link to `/for-employers`; a `402 employer_separate_product` is returned if they try to create an employer account |
| Fresh / free visitor | **`onboard`** — may create a free employer account (the v2 free tier) |

## Files changed

- **`public/index.html`** — mobile + desktop nav: "Login" button opens the chooser
  (`data-nav="login"`), "For Employers" → `/for-employers`, "Templates" removed from the
  mobile menu; the login-chooser modal + open/close script.
- **`public/for-employers.html`** — new public, indexable employer landing page (features +
  Free/Pro $49/Scale $199 pricing + two "Create Employer Account" CTAs into `/employer`).
- **`server.js`** — `employerPortalAccess()`; `access` field on `/api/employer/status`; the
  `blocked_pro` guard on `POST /api/employer/profile`.
- **`public/employer.html`** — a "separate product" screen (`nvBlocked`) shown on boot for
  `blocked_pro`; owner + employer accounts pass through.
- **`test/employer-portal-routes.js`** — access-model coverage (`blocked_pro` / `onboard` /
  `full`, the 402 block, and that `/for-employers` serves with the CTA).
- **`test/homepage-ui-bugs.js`** — updated the nav-order check to find the new Login button
  by `data-nav="login"` (the CI fix, see below).
- **`docs/MOBILE_NAV_LOGIN_FLOW.md`** — the plan, decisions, and open questions.

### Rode along on the same branch
- **`docs/WORK_REPORT_2026-08-14.md`** — added the Stripe employer **price IDs** (Pro
  `price_1U4QHkCgLyCpwXXjlHMDBmHq`, Scale `price_1U4QIgCgLyCpwXXjPy8UtUiS`) and the Railway
  setup steps.

## Verification

- Full `test/*.js` suite green (39 files), including the new access-model checks.
- The **login chooser** and the **`/for-employers`** page were rendered and visually checked.
- **CI:** the first run failed one assertion in `test/homepage-ui-bugs.js` (it located the
  desktop login control by `data-i18n="nav_login"`, which the new button dropped). Fixed by
  marking the button `data-nav="login"` and pointing the test at that; the `test` check then
  passed (`success`), all Netlify checks green.

## Decisions worth a second look (from `docs/MOBILE_NAV_LOGIN_FLOW.md`)

- **D1/D2 — free vs. paid employer portal.** Point 4 calls the portal a "completely separate
  *paid* product," but v2 ships a *free* employer tier (2 posts). Reconciled as: job-seeker
  Pro/Lifetime subs are blocked with the upgrade message, but a brand-new *free* visitor can
  still create a free employer account. **If you want the portal paid-only, that's a separate
  change — say so and I'll wire it up.**
- **i18n note:** the nav login button dropped its `data-i18n`, so it reads "Login" in the
  Chinese locale until a translation key is added. (Desktop keeps the `[中文][Login][CTA]`
  order.)

## Still outstanding (needs you)

1. **Add the two Stripe price IDs to Railway** (`STRIPE_EMPLOYER_PRO_PRICE_ID`,
   `STRIPE_EMPLOYER_SCALE_PRICE_ID`) to switch on employer checkout — they must match the
   live/test mode of `STRIPE_SECRET_KEY`.
2. **Confirm the free-vs-paid employer-portal decision** (D1/D2 above).
