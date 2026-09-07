# Application Tracker

Built on the **existing** "Applications" sidebar item — renamed to **Application
Tracker**, same href (`/candidate/applications`), no new menu item. Full page
(not a modal). `next build` green.

## What it does
A full page listing every job you've applied to. Per application:
company, role, date submitted, **days since submitted** (auto — "3 days ago",
"2 weeks ago", "1 month ago"), status, contact name/email, salary, location,
job URL, notes, the **resume version used** (dropdown linked to My Resumes), and
an optional **follow-up date** ("Follow up Sep 14", turns red when overdue).

- **Desktop:** sortable table. **Mobile:** cards.
- **Sort:** Date submitted (default), Company, Status, Days since applied.
- **Filter:** by status. **Search:** company or role.
- **Color-coded status badges:** Applied (violet), Phone Screen (sky),
  Interview (gold), Offer (teal), Rejected (red), Ghosted/Withdrawn (grey).
- **Add application** button → modal form with all fields.
- Click **Edit** on a row/card → same modal, pre-filled.
- **Delete** → confirmation dialog, then removed.

## Files
- `supabase/migrations/0004_applications.sql` — new `applications` table (your exact SQL).
- `lib/applications.ts` — types + CRUD (service role, auth-scoped).
- `app/api/applications/route.ts` (GET list, POST create) + `[id]/route.ts` (PATCH, DELETE).
- `app/candidate/applications/page.tsx` + `application-tracker.tsx` — the page.
- `components/candidate-sidebar.tsx` — "Applications" → "Application Tracker".

## Manual step (required for it to persist)
Run `supabase/migrations/0004_applications.sql` in the Supabase SQL editor
(service-role key already on Railway). Until then the page loads but shows an
empty list and saving reports an error.

## Heads-up on the PR
This landed on the **same open PR #456** (which also holds the three Phase-2 tool
fixes: ATS upload, Interview Practice, Job Finder empty-search) — because that PR
hadn't been merged yet and this project uses one working branch. So **merging
#456 ships both** the fixes and the Application Tracker. If you'd rather they be
separate PRs, tell me and I'll split them.

## Verify after deploy
Sidebar → **Application Tracker** → Add application (fill company/role, pick a
resume + status + follow-up date) → it appears in the table with "days since" →
edit it → change status → delete with confirm. Sort/filter/search all live.
