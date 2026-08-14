# Mobile Nav + Login Flow — Plan, Decisions & Open Questions

**Date:** 2026-08-14 · **Author:** Claude Code

Response to the request to fix the mobile navigation menu and login flow (7 points).
This documents the plan, the decisions I made where the spec was ambiguous, and the
open questions — then the work is built against these decisions.

---

## What's there today (so the changes make sense)

- The landing page (`public/index.html`) has **two** nav copies: a desktop bar and a
  `.mobile-menu` hamburger sheet (the screenshot). Both list: How It Works, Blog, For
  Employers, Free Tools, Pro Tools, Templates, Pricing, **Log In**, **Tailor My Resume Free**.
- A small **auth-aware script** swaps every "Log In" link to **"Dashboard" → `/dashboard`**
  once a stored token validates. That's why a signed-in owner sees "Dashboard," not "Log In."
- **"For Employers"** links straight to **`/employer`** (the portal / recruiter sign-in).
- The **employer portal** (`public/employer.html`) lets *any* signed-in user create a
  company profile ("Hire Mode") and enter — including the new **free employer tier**
  (2 lifetime job posts) shipped in Employer Portal v2.
- One account system: a single `users`/`sessions` table. "Job seeker" vs "employer" is a
  *surface/role*, not a separate credential store.

## Requirement-by-requirement plan

1. **"Dashboard" → "Login".** The mobile menu's login/dashboard button becomes **"Login"**
   and stops swapping to "Dashboard." Clicking it opens the chooser (point 2) — even when
   already signed in, so the owner can pick a side (point 3).
2. **Login chooser.** "Login" opens a small modal with **Login as Job Seeker** and
   **Login as Employer**. Job Seeker → `/login?redirect=/dashboard`. Employer → the employer
   login/onboarding (`/employer`), which then enforces access (point 4).
3. **Owner dual-access.** `OWNER_EMAIL` may use both surfaces with the same email. Because
   it's one account, this is really "the employer-portal gate never blocks the owner." Owner
   is exempt from every block below.
4. **Access control** (see decision D1 for the nuance):
   - **Employer-plan subscribers** (`employer_subscribers`, Pro/Scale) → full site (employer
     portal **and** job-seeker tools).
   - **Job-seeker Pro** (`subscribers`, monthly) and **Lifetime** → **blocked** from the
     employer portal; shown a "separate product" upgrade message instead.
   - **Owner** → full access.
   - Enforced **server-side** (`employerPortalAccess(email)` exposed on
     `/api/employer/status`), not just hidden in the client.
5. **"For Employers" (logged out) → new landing page.** New public page
   **`/for-employers`** explaining the employer features (post jobs, AI matching pipeline,
   tiers) with a **"Create Employer Account"** button at the bottom → the employer
   signup/onboarding (`/employer`). All "For Employers" nav links point here.
6. **Remove "Templates"** from the mobile hamburger menu.
7. **Menu behavior.** How It Works / Blog / Pricing / Pro Tools / For Employers →
   info pages. Only **Free Tools** and **Tailor My Resume Free** are direct-action buttons.

## Decisions on ambiguities (change any and I'll adjust)

- **D1 — The free employer tier vs "separate paid product."** Point 4 calls the employer
  portal a "completely separate paid product" and says to block Pro subscribers — but v2
  intentionally ships a **free employer tier** (2 lifetime posts). I reconciled them as:
  the employer portal is **its own product line**, entered by having an **employer account**
  (created via the onboarding, free tier included) **or** an employer plan. A **job-seeker
  Pro/Lifetime** subscriber does **not** get employer access from their job-seeker plan, and
  hitting the portal shows the upgrade/"separate product" message. **Assumption:** a
  brand-new *free* visitor can still create a free employer account (that's the v2 free
  tier). If instead you want the employer portal to be **paid-only** (remove the free tier
  entirely), tell me — that's a different, larger change.
- **D2 — Does the block also stop a Pro sub from making a free employer account?** Taken
  literally, "block Pro subscribers" does. I implemented the block as an **interstitial**:
  Pro/Lifetime users see "the employer portal is a separate product" with CTAs to the
  employer landing/plans, rather than being dropped into onboarding. They are not silently
  let in. Confirm whether a Pro sub should be allowed to *also* create a free employer
  account from that screen, or be pushed to a paid employer plan only.
- **D3 — One account, two doors.** "Login as Job Seeker/Employer" route to the same
  account system; they are not separate logins. The owner's "log into both" works because
  it's one identity with access to both surfaces.
- **D4 — Desktop too.** The ask says "mobile hamburger menu." I apply the **"For Employers →
  /for-employers"** link change and the **Login chooser** on **both** desktop and mobile for
  consistency (a desktop user shouldn't get the old behavior). The **"Templates" removal is
  mobile-only** as specified (the desktop bar doesn't list Templates).
- **D5 — Onboarding.** "Create Employer Account" reuses the existing employer sign-up +
  "create company profile" flow in `public/employer.html` as the onboarding. No new
  credential system.

## Open questions (answer any; defaults above hold otherwise)

1. **Is the employer free tier staying?** (D1) Default: **yes**, kept.
2. **May a job-seeker Pro sub create a free employer account**, or must they buy an employer
   plan? (D2) Default: shown the separate-product message with a path to create/upgrade.
3. **Apply the Login chooser on desktop too, or mobile-only?** (D4) Default: **both**.

## Build status

Implemented against the decisions above (nav changes, Login chooser, `/for-employers`
landing, server-side `employerPortalAccess`, employer-portal block for Pro/Lifetime with an
upgrade message, owner exemption). See the PR for the diff.
