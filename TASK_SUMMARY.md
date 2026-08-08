# Job Application Tracker — Task Summary

Date: 2026-08-08. Branch: `claude/free-tools-page-redesign-6h2rab`.
Built in one PR: a Job Application Tracker that exists as a standalone free tool
(`/job-tracker`) and as a native Pro dashboard tab, sharing one backend.

---

## What shipped

### Backend (`server.js`)
- **`applications` table** — created at startup with indexes on `user_email` and
  `status`. **Note:** the spec's `user_id INTEGER → users(id)` doesn't fit this
  app (the `users` table is email-keyed, no integer id), so rows are scoped by
  `user_email TEXT`, resolved from the bearer token via `getSessionEmail`. Same
  behavior, correct for this schema.
- **Routes** (all bearer-auth, `401` without a token):
  - `GET /api/applications` — list for the user; returns `isPro`, `limit`, `count`, `atLimit`, `statuses`.
  - `POST /api/applications` — create; **free users blocked at 20** (`403 free_limit`).
  - `PUT /api/applications/:id` — update (own rows only; `404` otherwise).
  - `DELETE /api/applications/:id` — delete (own rows only).
  - `GET /api/applications/stats` — aggregated stats; `advanced` block **Pro-only**.
  - `GET /api/applications/export` — CSV; **Pro-only** (`403` for free).
  - `GET /api/applications/autofill/jobs` — saved Job-Finder jobs; **Pro-only**.
- Every gate is server-enforced, not just UI.

### Shared UI (`public/job-tracker.js`)
One module, mounted by both placements via `JobTracker.mount({ container, toast, onUpgrade, getTailorJob })`:
- **Kanban board** (default) with drag-and-drop between the 7 status columns
  (Applied → Phone Screen → Interview → Offer → Rejected → Withdrawn → Ghosted).
- **List view** toggle — sortable by company, date, status.
- **Add/Edit modal** with every field; date defaults to today; delete + notes + follow-up.
- **Follow-ups Due** section (overdue = red), **Stats widget** (this-month, response
  rate, interviews, offers, avg days to response) + **8-week bar chart**.
- **Free vs Pro** mirrored from the API: 20-app banner + upgrade CTA; CSV export
  and auto-fill show a 🔒 lock and open the upgrade flow for free users.
- Empty state, cream/green design, horizontally-scrolling kanban on mobile,
  logged-out state prompting sign-in.

### Placements
- **Standalone `/job-tracker`** (`public/job-tracker.html`) — free tool, its own
  toast, upgrade → `/#pricing`.
- **Pro dashboard tab** (`app.html`) — sidebar button + `panel-jobtracker`,
  `initJobTracker()` mounts the module once with the app's `showToast` / `startPro`,
  and `getTailorJob` (auto-fill from the Tailor job URL). Reachable via
  `/dashboard?tab=jobtracker`.
- **Links**: `/score` Free Tools card, main site nav (`site-nav.js`, bilingual),
  app sidebar, and `sitemap.xml`.

### Tests (`test/applications.js`)
Boots the real app against a temp SQLite DB and drives every route: auth 401s,
CRUD, validation, the **20-app cap 403**, per-user isolation, stats (basic vs
Pro `advanced`), CSV export Pro-gating, and auto-fill Pro-gating. **34 assertions,
all pass locally**, and the full existing suite (29 test files) still passes.

---

## Auto-fill sources (as implemented)
- **Job Finder** → server reads the existing `saved_jobs` table (Pro).
- **Resume Tailor** → the Tailor flow doesn't persist "the job I tailored for," so
  in the dashboard this falls back to prefilling the **job URL** from the Tailor
  tab (Pro). If you want full company/title auto-fill from Tailor everywhere,
  persisting each tailored job is a small follow-up (noted in `JOB_TRACKER_NOTES.md`).

## Verification notes
- Backend + routes: **verified locally** (`node test/applications.js` → ALL PASS;
  full suite green).
- Frontend JS isn't covered by the node test suite (it drives routes, not a
  browser), so the module was written defensively and syntax-checked (`node -c`),
  but not click-tested in a browser here. Recommend a quick pass on the Netlify
  deploy preview (add/drag/edit/export on `/job-tracker` and the dashboard tab).
