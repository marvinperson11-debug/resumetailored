# Job Application Tracker — build notes & decisions

Building it all in one PR as asked. No blocking questions — but three decisions
where I adapted the spec to this codebase. Flagging them so nothing surprises you.

## 1. `user_id INTEGER` → `user_email TEXT` (necessary)
The spec's schema references `users(id)`, but this app's `users` table is
**email-keyed** (`email TEXT PRIMARY KEY`, no integer id) and all auth resolves a
bearer token → email (`getSessionEmail`). So the table uses
`user_email TEXT NOT NULL` (indexed), scoped to the session email. Same behavior,
correct for this schema. Indexes on `user_email` and `status` as requested.

## 2. Auto-fill sources
- **From Job Finder** → server endpoint reads the existing `saved_jobs` table
  (company/title/location/url) — Pro-gated (403 for free).
- **From Resume Tailor** → the Tailor flow doesn't persist "the last job I
  tailored for," so there's nothing server-side to read. In the **dashboard**,
  this auto-fills from the live Tailor tab's job-description field (client-side,
  Pro-only). On the **standalone page** it shows the Pro lock (there's no Tailor
  context there). If you'd rather persist each tailored job to enable this
  server-side everywhere, that's a small follow-up.

## 3. One shared UI, two placements
To avoid two diverging copies, the whole tracker (kanban, list, stats, modal,
reminders, gating) lives in one module — `public/job-tracker.js` — mounted by
both the standalone `/job-tracker` page and the dashboard tab. Same backend, same
behavior; only the Pro flag + toast host differ.

## Free vs Pro (enforced server-side, mirrored in UI)
| | Free (`/job-tracker`) | Pro (dashboard) |
|---|---|---|
| Applications | 20 (POST returns 403 at cap) | unlimited |
| Kanban + list + basic stats | ✅ | ✅ |
| CSV export | 🔒 403 | ✅ |
| Auto-fill (Job Finder / Tailor) | 🔒 | ✅ |
| Advanced analytics | 🔒 | ✅ |

The 20-cap and every Pro gate are enforced in the API (not just the UI), so a
crafted request can't bypass them — same posture as template gating.

## Testing
`test/applications.js` boots the real app against a temp SQLite DB and drives
every route (auth 401, CRUD, the 20-cap 403, stats aggregation, CSV export
Pro-gating, auto-fill Pro-gating) — no network. I'm installing deps to run it
locally; either way CI runs it. Frontend JS isn't covered by the node test
suite, so I've kept the module defensive and will note it wasn't runtime-verified
here (no browser/deps for the UI).

Deliverables: `/job-tracker` page, dashboard tab, `/score` card, migration + API,
`test/applications.js`, this doc + `TASK_SUMMARY.md`. Auto-merge on green.
