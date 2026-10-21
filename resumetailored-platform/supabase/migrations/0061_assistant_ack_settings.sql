-- Employer Portal AI Assistant — standing auto-application-acknowledgment
-- templates (Prompt 4).
--
-- The guardrail everywhere else in this feature is "no candidate-facing send
-- without approval". A standing template IS that approval: the employer
-- approves the EXACT template text once (through the normal pending-action
-- card, lib/assistant-mutations.ts), and this row is only ever written by
-- that approval (never by the chat turn that drafted it). From then on,
-- lib/assistant-ack-worker.ts's 15s scan (same loop as
-- lib/assistant-send-worker.ts) fires it automatically for every new
-- applicant that matches, with zero further LLM calls and zero further
-- approvals — editing the template is a NEW pending action, never an
-- in-place update of an approved row.
--
-- `job_id` nullable = account-wide; a job-specific row takes precedence over
-- an account-wide one for that job (lib/assistant-ack-worker.ts). At most one
-- enabled row per (employer_id, job_id) — enforced by the partial unique
-- indexes below (two, because a plain unique index can't express "job_id IS
-- NULL counts as a value" without enabling nulls-distinct behavior Postgres
-- doesn't have before 15, and this must work on whatever version production
-- is on).
--
-- Same access pattern as every other assistant_* table: service-role only,
-- RLS on with no policies, explicit grants. HAND-APPLIED, idempotent, safe
-- to re-run.

create table if not exists public.assistant_ack_settings (
  id uuid primary key default gen_random_uuid(),
  employer_id text not null,
  job_id bigint,
  template text not null,
  enabled boolean not null default true,
  actor_user_id text not null,
  actor_email text,
  created_at timestamptz not null default now()
);

create index if not exists assistant_ack_settings_employer_idx
  on public.assistant_ack_settings (employer_id);

-- At most one ENABLED account-wide (job_id is null) template per employer.
create unique index if not exists assistant_ack_settings_account_wide_idx
  on public.assistant_ack_settings (employer_id)
  where job_id is null and enabled;

-- At most one ENABLED job-specific template per (employer, job).
create unique index if not exists assistant_ack_settings_job_scoped_idx
  on public.assistant_ack_settings (employer_id, job_id)
  where job_id is not null and enabled;

alter table public.assistant_ack_settings enable row level security;

revoke all on public.assistant_ack_settings from public, anon, authenticated;
grant select, insert, update on public.assistant_ack_settings to service_role;
