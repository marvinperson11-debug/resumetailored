# Employer Sidebar → Candidate Parity

**PR #483** (merged) · **Deployed** to `app.resumetailored.com` (Railway deploy `0314ac72`, commit `61ae75f`, status SUCCESS).

---

## What was actually wrong (root cause)

The employer area was built on a **horizontal top nav with no persistent sidebar**, while the candidate area uses a persistent left sidebar (`DashboardShell`). So the two were structurally different, and every symptom you saw followed from that mismatch. The real fix wasn't nudging the toggle around — it was **making the employer portal use the exact same shell as the candidate portal.** It now does.

## Deliverable checklist — all ✅

1. **Hamburger on mobile** — the employer area now renders inside the shared `DashboardShell`, which shows a white ☰ (top-left) below 1024px that opens a **left slide-out drawer**; overlay-tap or ✕ closes it (and it now also closes on navigation). Desktop shows the sidebar permanently, no hamburger.
2. **Admin toggle at the bottom on BOTH sidebars** — candidate and employer both render it at the bottom, above **Sign out**.
3. **Admin toggle NOT at the top on employer** — it's removed from the header entirely; it exists only at the sidebar bottom, admin-only.
4. **Both sidebars consistent** — same header, same nav rows (icon left, text right, **gold left-border on active**), same Sign-out button, and a plan badge at the very bottom (candidate: "Pro · active"; employer: "Employer Portal").

The admin toggle itself is now short, **side-by-side, non-wrapping** buttons: **👤 Candidate | 🏢 Employer** — gold when active, dark when inactive.

## Files changed
- `app/employer/layout.tsx` — now renders `DashboardShell` + `EmployerSidebar` (was `EmployerTopNav`).
- `app/employer/components/employer-sidebar.tsx` — rewritten to mirror `CandidateSidebar`.
- `app/employer/components/employer-top-nav.tsx` — **deleted** (the old broken top nav).
- `components/dashboard-shell.tsx` — mobile drawer closes on route change (benefits both portals).
- `components/admin-view-toggle.tsx` — short, non-wrapping side-by-side labels.

## Verification
`tsc --noEmit` ✅ · `next lint --max-warnings=0` ✅ · `next build` ✅ · Railway deploy **SUCCESS**.

> The employer dashboard sits behind Clerk auth, which I can't drive headless here, so I verified via the build and by reusing the candidate `DashboardShell` mechanics (the same code path you've confirmed works on the candidate side) rather than a live authenticated mobile session. If you want automated proof, I can add a Playwright test that stubs auth.

---

## A note + a couple of small questions

**Note — if it still looks wrong after this, do a hard refresh.** The code on `main` *before* this PR already had the admin toggle at the bottom of the employer mobile drawer (from the prior PR #482), yet you described it at the top. That gap usually means a **stale cached build in the browser**. This PR replaces the whole employer shell, so a hard refresh (or a fresh load) should show the new persistent sidebar; if you still see the old top-nav layout, it's cache, not the deploy (the deploy is confirmed live).

**Questions (none blocking — current choices are shipped):**

1. **Bottom plan badge text.** I used a static **"Employer Portal"** badge (parallel to the candidate's "Pro · active"). Want it to show the actual tier/price instead — e.g. **"Portal · $49/mo"**, or Free / Scale / Corporate per the employer's real plan? I kept it static because `access` doesn't currently carry the employer tier; wiring the real tier is easy if you want it.
2. **Swipe-to-close.** The shared drawer closes on **overlay-tap / ✕ / navigation** — identical to the candidate drawer. I did **not** add left-swipe-to-close, since the candidate drawer (your "correct" reference) doesn't have it and you asked for identical behavior. Want me to add swipe-to-close to *both* drawers?
3. **`Hire` label.** Your spec listed a **"Hire"** nav item, but the live employer nav uses **"Jobs"** (`/employer/jobs`). I kept "Jobs" to match the existing route/pages. Want it renamed to "Hire"?

## Other open work (unchanged)
- **#481** email notifications — still an open **draft**, awaiting your go-ahead to merge after you test the emails.
- The only red CI anywhere is the **pre-existing homepage-nav test** on `main` (unrelated to any of this employer work). I can fix it in a tiny separate PR whenever you'd like, to get CI fully green.
