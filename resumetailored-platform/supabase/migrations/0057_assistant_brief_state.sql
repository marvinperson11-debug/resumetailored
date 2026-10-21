-- Employer Portal AI Assistant — daily morning brief idempotency (Prompt 3).
--
-- One row per employer. lib/assistant-brief.ts `runDailyBriefScan` sets
-- `last_brief_at` BEFORE attempting the brief's LLM call (not after) — this
-- is what caps a brief at one-per-employer-per-day even if the LLM call or
-- the email send fails and the next 30-minute tick runs before the day
-- boundary passes again: a retry storm on a slow/failing brief would
-- otherwise burn the same daily allowance repeatedly. `brief_hour` lets a
-- later admin control add a per-employer preferred send hour; every employer
-- defaults to 7 (server-local).
--
-- Same access pattern as every other assistant_* table: service-role only,
-- RLS on with no policies, explicit grants. HAND-APPLIED, idempotent, safe to
-- re-run.

create table if not exists public.assistant_brief_state (
  employer_id text primary key,
  last_brief_at timestamptz,
  brief_hour int not null default 7
);

alter table public.assistant_brief_state enable row level security;

revoke all on public.assistant_brief_state from public, anon, authenticated;
grant select, insert, update on public.assistant_brief_state to service_role;
