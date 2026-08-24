# Top Nav + Login Flow — Plan & Notes

Branch: `claude/live-site-fixes-2ffkxa` (restarted from `main`).

## What I'm building

### 1. 中文 toggle → top nav, beside the hamburger, white, every page
The shared top nav (`public/site-nav.js`, `#snav`, injected on every public page) keeps
the 中文 toggle in `.snav-act`, which is **hidden** below 1180px, with a duplicate inside
the hamburger menu. Fix: put 中文 in an always-visible actions cluster beside the hamburger
(shown at every width), make it **white**, and remove the copy from inside the hamburger.

### 2. Login button → top nav, beside 中文, luxury style, every page
Add a **Login** button to the same always-visible cluster (gold border / cream text, subtle
hover). Visible at every width without opening the hamburger.

### 3. Login → role-selection modal
Clicking **Login** opens a modal: "Are you logging in as a Job Seeker or an Employer?"
- **Job Seeker** → `/login` (job-seeker login → job-seeker dashboard)
- **Employer** → `/employer` (employer portal + its own login → employer dashboard)

The modal is injected by `site-nav.js`, so it works on every public page.

### 4. Login tied to subscription — routing & separation
`getSessionEmail` resolves the `rt_session` cookie, so the server can gate navigations.
Roles from existing helpers: `isSubscriber` = job-seeker Pro/Lifetime; `employerTier` /
`isEmployerSubscriber` = employer Pro/Scale/Corporate.

Routing:
- After login, send the user to the dashboard that matches their subscription.
- `/dashboard` (job-seeker): a **paid employer who is not also a job-seeker subscriber** is
  redirected to `/employer`.
- `/employer`: a **job-seeker Pro/Lifetime who is not also an employer** is redirected to
  `/dashboard`.
- Redirects (not hard 403s) so nobody is locked out; the owner/comped account keeps access
  to both sides.

> **⚠️ Design conflict I'm flagging (not a blocker — tell me if you want it changed):**
> The current code *intentionally* lets the two sides overlap — a comment in `server.js`
> reads: *"The free employer tier is open to ALL — including job-seeker Pro/Lifetime …
> owner logs into both sides."* Strict separation contradicts that. My implementation:
> - **Paid** single-role users are separated (a pure employer can't sit on the job-seeker
>   dashboard and vice-versa) — this is the core of your request.
> - **Free** users are still allowed to onboard on either side (so the employer sign-up
>   funnel from free/job-seeker accounts isn't broken), and the **owner** keeps both.
> If you want it fully strict (even free job-seekers blocked from the employer side, hard
> 403 instead of redirect), say so and I'll tighten it.

### 5. Mobile
Top nav (hamburger + 中文 + Login) visible and functional at mobile widths; the app's
bottom tab bar stays visible on all pages incl. Video (already fixed previously — re-verified).

## Verification — DONE

**Headless Chromium (real render, not source grep):**
- Shared site-nav pages (`/software-engineer-resume`) at **390px** and **1280px**: white 中文
  (`#fff` bg, navy text) + gold-outline **Log In** + hamburger all visible beside each other;
  role modal opens with **Job Seeker** / **Employer** + the prompt "Are you logging in as…".
- Homepage club-nav at **390px** and **1280px**: exactly **one** visible 中文 (the top-nav
  `club-nav__lang`, white) + **Login** + hamburger; `#loginChooser` opens with the same
  two roles + prompt. (No duplicate — the server's global-toggle injector detects the
  existing control and stays hidden.)

**Regression suite — 60/60 green on BOTH:**
- **Node 20.20.2** (the requested version): 60 PASS / 0 FAIL, incl. `production-e2e.js`
  (which SKIPs on any other version). Required a one-off `npm rebuild better-sqlite3`
  against Node 20 — the checked-in native binary was built for Node 22 — then rebuilt back
  for the container's default Node 22 so nothing is left broken. CI builds it for its own
  Node 20 automatically.
- **Node 22.22.2** (container default): 60 PASS / 0 FAIL.

**Two obsolete assertions updated in `test/navigation-flows.js`** — they encoded the *old*
behavior this task removes (中文 living inside the hamburger via `langToggleBtnMobile`, and
`.club-nav__actions` hidden on mobile). They now assert the new intent: 中文 on the top bar
and the actions cluster staying visible on mobile.

Next: commit → push → PR → confirm Railway deploy.
