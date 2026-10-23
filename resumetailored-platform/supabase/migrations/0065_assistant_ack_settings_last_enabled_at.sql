-- Employer Portal AI Assistant — auto-ack enable clock (Fix Round 4, Section B).
--
-- The worker (lib/assistant-ack-worker.ts) used to gate a send on
-- `applicant.created_at >= assistant_ack_settings.created_at` — the row's
-- INSERT time, which never moves. Re-enabling a disabled standing
-- acknowledgment (either the initial approval, which is also an "enable", or
-- the Settings panel's Turn-on toggle) therefore retro-fired acks to every
-- applicant who arrived during the OFF window, as far back as the original
-- approval (the Oct 23 incident this column fixes).
--
-- `last_enabled_at` is a SEPARATE clock that moves every time a row is
-- (re-)enabled — stamped at the initial approval execution
-- (lib/assistant-mutations.ts `executeSetAckTemplate` -> `createAckSetting`)
-- and at every re-enable, including the Settings panel's PATCH toggle
-- (lib/assistant-ack-settings.ts `setAckSettingEnabled`). The worker now
-- gates on `enabled = true AND applicant.created_at >= last_enabled_at`, so
-- every enable starts a new clock and there is no catch-up for the time the
-- template was off.
--
-- Backfilled from `created_at` for every existing row so a row enabled
-- before this migration keeps its current behavior (the clock it already
-- had) rather than retroactively gaining — or losing — eligibility for
-- applicants already in flight.
--
-- Pure ALTER TABLE on an existing table — same no-new-grants precedent as
-- 0054/0055/0058/0059/0060/0062/0064: assistant_ack_settings already grants
-- select/insert/update to service_role (migration 0061), and a new nullable
-- column needs no additional grant. HAND-APPLIED, idempotent, safe to re-run.

alter table public.assistant_ack_settings add column if not exists last_enabled_at timestamptz;

update public.assistant_ack_settings set last_enabled_at = created_at where last_enabled_at is null;
