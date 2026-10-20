-- Interview reminder flags (Employer Portal AI Assistant, Phase 0).
--
-- The in-process scheduler (instrumentation.ts) now also scans `interviews`
-- every 30 minutes (lib/interview-reminders.ts) and emails the CANDIDATE a
-- reminder 24h and 2h before a scheduled interview. These two flags are the
-- idempotency markers — same shape as `reminder_30_sent_at`/`reminder_7_sent_at`
-- on `employee_certs` (migration 0035), except boolean (no "which window" value
-- to preserve) since an interview's scheduled_at, unlike a cert's expiry_date,
-- is not expected to require re-arming these on a plain reschedule UPDATE; a
-- genuine reschedule should go through delete+recreate or an explicit reset if
-- that behavior is ever wanted.
--
-- HAND-APPLIED, idempotent, safe to re-run (same convention as every other
-- migration here).

alter table public.interviews add column if not exists reminder_24h_sent boolean not null default false;
alter table public.interviews add column if not exists reminder_2h_sent boolean not null default false;
