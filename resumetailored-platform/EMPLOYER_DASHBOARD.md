# Employer Dashboard (Phase 3) — build notes

A complete, self-contained employer area at **`/employer`** with its own top-nav
layout, onboarding, and five tools: Dashboard, Jobs, Candidates, Team, Settings.
Distinct from the candidate sidebar app — different navigation, a more corporate
register (solid panels, less glow), same navy/violet tokens.

## ⚠️ What you need to run

**Run the migration `supabase/migrations/0012_employer.sql`** in the Supabase SQL
editor. It creates the five tables from the spec verbatim — `employer_profiles`,
`job_postings`, `applicants`, `team_members`, `match_scores` — with their indexes
and RLS enabled. The server writes everything with the service-role key (scoped by
`employer_id`/`user_id` in each query), the same pattern as every other table here,
so RLS is on with no public policies.

Until it's run, the portal loads but reads come back empty and writes fail
gracefully (best-effort everywhere — nothing throws).

**Optional env:** `RESEND_API_KEY` (+ optional `RESEND_FROM`) turns on real invite
emails. Without it, invites still work — the invite **link** is shown to copy/share.

## How an employer becomes an employer (role sync)

This was already wired and needed no change here: the **old site's Stripe webhook**
(intentionally unchanged) sets `publicMetadata.plan = "employer"` in Clerk after
employer checkout, and `lib/plan.ts` (`getAccess`) reads it — with a one-time
backfill from the legacy subscriber DB via `/api/entitlement` if the flag isn't set
yet. So "sync role to Employer, same pattern as Pro" is the existing mechanism; I
only consumed it.

**Routing by role after sign-in:** the sign-in/sign-up pages now send users to `/`,
and root (`app/page.tsx`) routes by role — **employer or employee → `/employer`**,
everyone else → `/candidate`. A Pro-upgrade intent (`?upgrade=pro`) still goes
straight to the candidate modal, and an internal `?redirect_url` (the invite flow)
is honored.

## Onboarding

First time an employer opens `/employer` with no company profile, a **blocking
onboarding modal** collects company name / website (optional) / industry / size and
POSTs to `/api/employer/profile`. On save it refreshes into the real dashboard.
Employees who join an already-onboarded company never see it.

## The five sections

- **Dashboard (`/employer`)** — four stat cards (active postings, total applicants,
  new this week, team members), three quick actions (Post a job / View candidates /
  Invite team member), and a **recent-activity feed** (new applicants with match
  score, postings expiring within 3 days, team members who joined).
- **Jobs (`/employer/jobs`)** — table (title, status pill, applicant count, posted,
  expires, actions: Edit / Pause·Activate / Close / Duplicate / View applicants /
  Delete) + a full **job editor modal**: title, department, work-model + city,
  employment type, salary min/max/currency, description with **"Improve with AI"**,
  add/remove **Requirements** and **Nice-to-haves** bullet lists, deadline, and
  **Save draft** or **Publish now**.
- **Candidates (`/employer/candidates`)** — table across all jobs (name, applied-for,
  **match score**, status, applied date) with filters (job / status / min-score) and
  sort (newest / best match). A **detail drawer** shows the resume + cover letter,
  **AI match analysis** (green ✓ met / red ✗ missing, experience & skills sub-scores,
  top-3 strengths + 2 gaps + verdict), a status dropdown + private notes, a
  **message template picker** (compose via mailto), a schedule-interview placeholder,
  and **Shortlist / Reject**. "Add applicant" supports manual entry (there's no public
  job board yet) so scoring has something to run on.
- **Team (`/employer/team`)** — roster (email, role, active/pending, added) with role
  change, remove, and resend-invite (copies a fresh link). **Invite** creates a
  pending row + a `/join?token=…` link (emailed when Resend is configured). The owner
  row is protected server-side. Employees see the roster read-only.
- **Settings (`/employer/settings`)** — edit the company profile; plan summary.

## AI routes (Claude `claude-sonnet-4-6`)

- **`POST /api/employer/jobs/assist`** — `{ title, notes, … }` → a polished, inclusive
  job description. Available to every employer (no extra gate).
- **`POST /api/employer/match-score`** — score a resume vs. a role. Pass
  `{ applicantId, jobId }` to score a stored applicant (**cached** in `match_scores`
  and written back to the applicant row; a cache hit returns free), or
  `{ jobDescription, jobRequirements[], resumeText }` ad-hoc. Falls back to a
  deterministic keyword estimate if the AI provider is unavailable.

All other routes are plain CRUD under `/api/employer/*` (`profile`, `jobs[/:id]`,
`candidates[/:id]`, `team[/:id]`), each gated to the employer workspace.

## Team invites & the Employee role (`/join`)

An invite link is `/join?token=<uuid>`. `app/join/page.tsx`:
signed-out → bounce through sign-in and return; signed-in → validate the token,
set the **Employee** role in Clerk metadata **scoped to that employer**
(`{ plan:"employee", employerId, employerName }`), activate the team row, and land
`/employer`. Invalid/expired tokens show a friendly message.

This is why `lib/plan.ts` gained `employerId` on `Access` plus `canUseEmployerPortal`
and `resolveEmployerId` — so an employee's requests resolve to **their employer's**
workspace, not their own id. Every employer API route and the layout use
`resolveEmployerId`, so owner and employee see the same company data.

## Files

**New libs**
- `lib/employer-ai.ts` — taxonomy constants (industries, sizes, statuses, roles),
  data types, and the two AI helpers (job-assist prompt, match-score prompt +
  `normalizeMatch` + `localMatchFallback`). Pure.
- `lib/employer-store.ts` — Supabase service-role store: profile, jobs (CRUD +
  duplicate + counts), applicants (list/filter/sort + ownership-checked get/update +
  manual create), match cache, team (list/invite/update/remove + token accept), and
  the dashboard stats + activity composer.
- `lib/employer-auth.ts` — `requireEmployerId()` / `employerContext()` (resolve the
  workspace id from Clerk auth + role).

**New routes** — `app/api/employer/{profile,jobs,jobs/[id],jobs/assist,candidates,candidates/[id],match-score,team,team/[id]}/route.ts`

**New pages/components** — `app/employer/layout.tsx` (rewritten to top-nav + gate +
onboarding), `app/employer/page.tsx` (dashboard), `app/employer/{jobs,candidates,team,settings}/`
(server page + client), `app/employer/components/{ui,employer-top-nav,onboarding-modal}.tsx`,
`app/join/page.tsx`.

**Edited** — `lib/plan.ts` (+`employerId`, `canUseEmployerPortal`, `resolveEmployerId`),
`app/page.tsx` + both auth pages (role-aware post-sign-in routing),
`supabase/migrations/0012_employer.sql`.

## Decisions worth noting

- **No public job-application flow** was in scope (candidates "apply" externally), so
  Candidates supports **manual applicant entry** to seed the pipeline and give the AI
  scorer real input. If you later add a public `/apply` page, it just inserts into the
  same `applicants` table.
- **Match scores are cached** per `(applicant_id, job_id)` in `match_scores` and
  mirrored onto the applicant row, so a re-open doesn't re-bill; "Re-score" forces a
  refresh.
- **Owner row is protected** — it can't be demoted, removed, or role-changed through
  any route; only the employer owner (not employees) can invite/manage the team.
- The legacy `app/employer/[...slug]` placeholder and the old `employer-sidebar.tsx`
  are left in place but are no longer part of the nav; the five explicit routes take
  precedence. Happy to remove them in a follow-up.

Build: `next build` → **✓ Compiled successfully**, lint + types clean.
