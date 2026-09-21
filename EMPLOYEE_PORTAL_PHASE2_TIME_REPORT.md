# Employee Portal — Phase 2 (Time)

Time Clock, Schedule, and Time Off for the workforce Employee Portal, plus the
outstanding discoverability items. All work is in the Next.js app
(`resumetailored-platform/`) except the marketing-site links and the
`/employee` 301, which are in the root Express app.

**Raw hours only** — no overtime, no wage math, no accrual balances, by design.

---

## 1. Time Clock

- **Clock in/out on the portal home** — a live-ticking widget on
  `/employee` (`time-clock-widget.tsx`): clock in, clock out, an optional note,
  and today's punches. At most one open entry per employee (enforced by a
  partial unique index).
- **My hours** (`/employee/timesheet`) — the employee's own week, with a week
  stepper, a per-day breakdown, the weekly total, and the employer's
  approval status + note (read-only for the employee).
- **Timesheets** (employer, `/employer/timesheets`) — per-employee weekly
  timesheets with an expandable per-day detail, **Approve / Decline** (+ note),
  and **CSV export** (`GET /api/employer/timesheets/export?week=`). One row per
  punch plus a per-employee total row; raw hours.

## 2. Schedule

- **Employer weekly grid** (`/employer/schedule`) — post shifts per employee ×
  day, then **Publish week**. New shifts are drafts (dashed gold) until
  published (solid violet). Each cell overlays the employee's submitted
  availability (green ✓ / red ✗) and any approved time off.
  - Named `/employer/schedule` to avoid colliding with the existing
    `/employer/scheduler` (video-interview scheduling).
- **My schedule** (`/employee/schedule`) — the employee's **published** shifts +
  approved time off on one timeline.
- **Availability** — the employee submits recurring (weekly) or date-specific
  windows, marked available/unavailable, visible to the employer on the grid.

## 3. Time Off

- **Employee** (`/employee/time-off`) — request a date range + type
  (vacation / sick / other) + reason; see the status of every past request.
- **Employer** (`/employer/time-off`) — a Requests view filtered by
  pending / approved / declined / all, with **Approve / Decline** (+ note).
  Approved requests surface on the schedule grid for the covered dates.

## 4. Discoverability (folded in)

| Item | Where | Status |
|---|---|---|
| Homepage employee link | `public/index.html` login chooser — new **Employee** card → `app.resumetailored.com/employee` | added |
| App sign-in "Employee portal" link | `app/sign-in/[[...sign-in]]/page.tsx` | added |
| Invite-email return URL | already correct — the invite links to `/employee/accept?token=…` and acceptance lands the employee in `/employee` | already built |
| `resumetailored.com/employee` → `app.resumetailored.com/employee` **301** | root `server.js`, before the HTML resolver / static | added |

---

## Data model — migration `0033_employee_time.sql`

**Migration number:** `0033` (next free; `0032` was the last).
**Hand-applied:** run `supabase/migrations/0033_employee_time.sql` against the
Supabase project before deploying. It is **idempotent**
(`create … if not exists` / `drop policy if exists`) and safe to re-run.

Five tables, all owner-scoped by `employer_id` (Clerk user id, TEXT) with
service-role access + RLS owner-only as defense in depth — the same pattern as
`0029`/`0031`. Every table `references employees(id) on delete cascade`.

| Table | Purpose |
|---|---|
| `time_entries` | clock in/out (`clock_out is null` = open; partial unique index caps one open entry/employee) |
| `timesheet_reviews` | per-`(employee, week_start)` approve/decline (+ note); unique on `(employer_id, employee_id, week_start)` |
| `shifts` | employer-posted shifts (`HH:MM` local times, `published` flag) |
| `availability` | employee windows (`recurring` weekday, or `date`-specific; `available` true/false) |
| `time_off_requests` | date range + `kind` + reason → employer status + note |

Weeks are **Monday-anchored, UTC** — `week_start` is a plain `date` computed in
the app layer (`lib/time-hub.ts` `weekStartISO`), so the DB never has to agree
on a locale.

## Code map

**Pure core (no DB / network), unit-testable:** `lib/time-hub.ts` — types,
validators, week maths (`weekStartISO`, `weekDates`, `weekLabel`), hour maths
(`entryHours`, `sumHours`, `formatHM`), shift/availability/time-off helpers, and
the CSV builder (`buildTimesheetCSV`).

**Persistence (service-role, best-effort):** `lib/time-store.ts`.

**API routes**

- Employee: `time-clock`, `timesheet`, `schedule`, `availability`
  (+ `[id]` DELETE), `time-off` — all gated by `employeeContext()`.
- Employer: `timesheets` (+ `review`, `export`), `schedule` (+ `[id]`,
  `publish`), `time-off` (+ `[id]`) — all gated by `employerContext()` **and**
  `canUseEmployerPortal(access)`, so a workforce employee (whose
  `resolveEmployerId` still returns an employer) can never reach the employer
  management endpoints.

**UI**

- Employee: home clock widget, `timesheet/`, `schedule/` (+ availability
  editor), `time-off/`; two new sidebar items (My schedule, My hours) + the
  now-live Time off.
- Employer: `timesheets/`, `schedule/`, `time-off/`; three new sidebar items
  (Schedule, Timesheets, Time off), all built with the existing employer UI kit
  (`app/employer/components/ui.tsx`).

## Verification

- `npx tsc --noEmit` — clean
- `npx next lint --max-warnings=0` — clean
- `npx next build` — success (all new routes compiled)
- `node -c server.js` (root) — syntax OK

The platform has no test runner (`npm test` is unconfigured), so no automated
tests were added, matching the existing convention; the pure helpers in
`time-hub.ts` are structured for straightforward unit testing if one is added.
