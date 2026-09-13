# Employer Dashboard UI Fixes — Hamburger Menu + Admin Toggle

**PR #482** (merged) · **Deployed** to `app.resumetailored.com` (Railway deploy `b7d80ceb`, commit `6fd4bfe`, status SUCCESS).

---

## ✅ Issue 1 — Mobile/tablet hamburger + slide-out drawer

- Added a **left-aligned hamburger** (white icon, 24px / `h-6 w-6`) to the employer top nav, shown **only below `lg` (1024px)**.
- Tapping it opens a **left slide-out drawer** — the same pattern as the candidate dashboard shell.
- The drawer shows the full employer nav: **Dashboard, Jobs, Candidates, Messages, Shortlists, Scheduler, Team, Settings**.
- Closes on: **overlay tap**, the ✕, a **left swipe**, or tapping any nav link. Body scroll is locked while open.
- New `EmployerSidebar` component holds the nav as a single source of truth (`EMPLOYER_NAV`), reused by the desktop top bar so the two never drift.
- Removed the previous (right-side, dropdown) hamburger. **Desktop layout is unchanged.**

## ✅ Issue 2 — Admin view toggle moved out of the header

- **Removed** `AdminViewToggle` from **both** top bars (employer nav + the candidate `DashboardShell` header).
- **Moved** it to the **bottom of the sidebar, above Sign out**, admin-only.
- Restyled as a small, subtle segmented switch — **👤 Candidate View | 🏢 Employer View** — with a **gold accent** on the active side. Same navigation behavior (`/candidate` ↔ `/employer`).
- Gated by the existing `isAdmin` check → `user_3Iy2uXv7HW15FGIF1b3mv7iZm1M` (env-overridable via `ADMIN_USER_ID`). Non-admins never see it.
- Candidate side: it now sits at the bottom of the persistent desktop sidebar **and** the mobile drawer.

## Verification
- `tsc --noEmit` ✅ · `next lint --max-warnings=0` ✅ · `next build` ✅ · Railway deploy **SUCCESS**.
- The one red CI check (`test`) is the **pre-existing homepage-nav failure on `main`** (documented on #480/#481) — unrelated; this diff touches nothing in `public/`.

### On "confirm the hamburger works on mobile"
I verified via the production build and by reusing the already-proven candidate drawer pattern (identical fixed-overlay + `lg:hidden` + slide-in structure). I could **not** drive a live authenticated mobile session end-to-end: the employer dashboard is behind Clerk auth, which can't be scripted headless here without credentials. If you'd like automated proof, I can add a Playwright test that stubs auth — say the word.

---

## ⚠️ One decision I need from you: admin toggle on the *desktop* employer view

This is the one spot where the spec and the actual layouts don't quite line up, so I want your call rather than guessing:

- The **candidate** area has a **persistent desktop sidebar**, so the toggle shows at its bottom on desktop *and* mobile. 👍
- The **employer** area uses a **top nav bar on desktop** (no persistent sidebar) — the sidebar only exists as the mobile drawer. So after this change, an admin on the **desktop employer view** has **no visible toggle** (it's only in the mobile drawer now, and I removed it from the header per the spec).

Today an admin on desktop employer can still switch back by going to `/candidate` directly, but there's no button for it. Options:

1. **Leave as-is** — toggle is mobile-drawer-only on the employer side; on desktop the admin navigates via the candidate sidebar / URL. (Matches "keep it out of the header" literally.)
2. **Add a slim, subtle toggle to the desktop employer view** somewhere that isn't the header — e.g. a small persistent chip bottom-left, or a tiny left mini-rail. (Keeps parity with candidate desktop.)
3. **Allow it back in the employer header on desktop only** (a compromise on the "out of the header" rule, but restores the one-click switch).

My recommendation: **Option 2** (a subtle bottom-left chip on desktop employer) — it honors "out of the header," keeps the admin's one-click switch on desktop, and matches the candidate experience. Tell me which you'd like and I'll ship it as a small follow-up.

---

## Status of the other open work
- **#480** Phase 1A (Messages/Shortlists/Scheduler) — merged & deployed.
- **#481** Email notifications — still an **open draft**, awaiting your go-ahead to merge (held so you can test the emails first). Its only red check is the same unrelated homepage-nav test.
- Optional: I can open a tiny PR to fix that homepage nav-order test on `main` so CI goes fully green across the board — separate from all this. Let me know.
