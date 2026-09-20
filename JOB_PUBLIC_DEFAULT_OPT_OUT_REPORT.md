# Job posting — public listing ON by default (opt-out)

**Branch:** `claude/slug-aliases-301-redirects-l3flqg` (restarted from latest `main` after PR #525 merged)
**PR:** [#526 (draft)](https://github.com/marvinperson11-debug/resumetailored/pull/526)
**Scope:** `resumetailored-platform/` (Next.js + Supabase app)

---

## Goal

Flip the public-listing default for employer job postings from **opt-in** to
**opt-out**. Every Active job is public by default; the employer hides a role
instead of having to list it.

## The one change

**`app/employer/jobs/jobs-client.tsx`** — the create + edit job form:

1. **Checkbox re-framed (opt-in → opt-out).**
   - Was: *"List on the public job board"* (checked = listed).
   - Now: *"Hide this job from the public careers page and /jobs"* (checked =
     hidden), **unchecked by default**.
   - Bound as `checked={!publicListed}` /
     `onChange={(e) => setPublicListed(!e.target.checked)}`.
   - Helper copy updated: *"Active jobs are public by default … Check this to
     keep this role off both, even while Active. Draft and closed jobs are never
     public."*

2. **Default for new jobs = public.**
   - `useState(job ? !!job.publicListed : true)` — a brand-new job starts
     `publicListed = true`; **editing an existing job keeps its saved value**, so
     nothing is mass-flipped.

## Why nothing else had to change

- **Server already honors the sent value.** `POST /api/employer/jobs`
  (`publicListed: !!b.publicListed`) and `PATCH /api/employer/jobs/[id]`
  (`if (b.publicListed !== undefined) patch.publicListed = !!b.publicListed`)
  both write exactly what the form sends. The store's `jobRow` maps it to
  `public_listed`.
- **Draft & closed jobs stay hidden.** Every public read
  (`listPublicJobs`, the single public job fetch, the apply route, and
  `getPublicCareerSite`) already filters on **`status = 'active'` AND
  `public_listed = true'`. A non-active or hidden job never surfaces.
- **Existing data untouched.** No migration, no data backfill. The column
  default (`public_listed default false`, migration 0016) is irrelevant to new
  rows now because the form always sends an explicit `true`/`false`; existing
  rows keep whatever they already had until the employer re-saves them.

## Behavior matrix (after this change)

| Job state | Hide box | Appears on /jobs + careers page? |
|---|---|---|
| New, Active | unchecked (default) | ✅ yes |
| New, Active | checked | ❌ no |
| Active | (existing value preserved on edit) | per stored `public_listed` |
| Draft / Closed | any | ❌ never |

## Verification (in `resumetailored-platform/`)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ pass (exit 0) |
| `npm run lint` (`next lint`) | ✅ No ESLint warnings or errors |
| `npm run build` (`next build`) | ✅ pass |

## Constraints met
- ✅ Small PR — single file changed.
- ✅ No new dependencies, no schema/migration change.
- ✅ `tsc` / lint / build green.
- ✅ Existing `public_listed` values left as-is.
