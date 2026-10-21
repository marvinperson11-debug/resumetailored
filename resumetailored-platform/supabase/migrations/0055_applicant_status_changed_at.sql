-- Employer Portal AI Assistant — pipeline-staleness tracking (Prompt 3).
--
-- "Stale pipeline items" (the daily morning brief, and the `get_pipeline_health`
-- tool — lib/assistant-staleness.ts) need to know how long a candidate has sat
-- in their current stage. `applicants` had no such timestamp before this
-- (only `created_at`, the application date). Existing rows are backfilled to
-- `created_at` — the correct lower bound for "unchanged since": we don't know
-- when a pre-migration row's status last changed, only that it hasn't changed
-- since it was created (if it HAD changed since creation, the oldest true
-- value for "since" is unknowable, so this slightly overstates staleness for
-- a handful of legacy rows rather than ever understating it).
--
-- lib/employer-store.ts `updateApplicant` sets this column to now() on every
-- status change going forward, so the backfill only matters for rows that
-- predate this migration.
--
-- Pure ALTER TABLE on an existing table — same no-new-grants precedent as
-- 0054. HAND-APPLIED, idempotent, safe to re-run.

alter table public.applicants add column if not exists status_changed_at timestamptz;
update public.applicants set status_changed_at = created_at where status_changed_at is null;
alter table public.applicants alter column status_changed_at set default now();
alter table public.applicants alter column status_changed_at set not null;
