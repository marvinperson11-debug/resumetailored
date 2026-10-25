-- Distribution Fix 1, Section C (Kimi prompt v3 follow-up) — one-time backfill
-- of job_postings.published_at for listings that went active+public BEFORE
-- migration 0071 added the column (and before the PATCH route / create route
-- / assistant mutations started stamping it). Those rows have published_at
-- IS NULL today, which means:
--   - Google Jobs markup (lib/job-posting-lifecycle.ts buildJobPostingJsonLd)
--     omits datePosted/validThrough entirely for them.
--   - computeValidThrough has nothing to add 30 days to, so
--     isJobPastValidThrough() is permanently false and they are NEVER picked
--     up by the weekly expiry nudge (lib/job-expiry-nudge.ts) even once truly
--     stale.
--
-- Stamping published_at = now() rather than back-dating to created_at is
-- deliberate: a listing that has been live for months would otherwise look
-- instantly expired the moment the 30-day window is computed from an old
-- created_at, firing an immediate (and misleading) expiry nudge. now() gives
-- every pre-existing listing a fresh 30-day window starting from the
-- backfill itself. Going forward, every NEW publish is covered by the create
-- route (app/api/employer/jobs/route.ts) and the PATCH route
-- (app/api/employer/jobs/[id]/route.ts), both of which stamp at the real
-- moment of first publish — this backfill only touches the historical gap.
--
-- Scope, by design:
--   - status = 'active' AND public_listed = true only — a draft or a
--     paused/closed job has no publish moment to backfill.
--   - published_at IS NULL only — idempotent; a job with a real stamp
--     (even one from a job that was later unpublished and republished) is
--     never touched, so this can be re-run safely and never moves a stamp
--     that already reflects a real publish/republish event.
--   - This fills a NULL system timestamp only. No employer-authored field
--     (title, description, pay, etc.) is read or written.
--
-- HAND-APPLIED via the Supabase SQL editor (service_role), like every other
-- migration in this repo. Run the PREVIEW query first and keep its output
-- for Marvin's review (affected job ids + employer accounts) before running
-- the UPDATE; run the VERIFY query after to confirm the backfill matches
-- what the preview promised.

-- ── PREVIEW (run first, for the build report) ───────────────────────────────
-- select id, employer_id, title, status, public_listed, created_at
-- from public.job_postings
-- where status = 'active' and public_listed = true and published_at is null
-- order by id;

-- ── BACKFILL ─────────────────────────────────────────────────────────────────
update public.job_postings
set published_at = now()
where status = 'active'
  and public_listed = true
  and published_at is null;

-- ── VERIFY (run after) ───────────────────────────────────────────────────────
-- Expect zero rows: every active+public job now has a published_at.
-- select id, employer_id, title
-- from public.job_postings
-- where status = 'active' and public_listed = true and published_at is null;
