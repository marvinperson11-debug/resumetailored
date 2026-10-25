-- Onboarding chase — Prompt 6, Section 3.
--
-- One row per applicant whose offer envelope has transitioned to
-- 'completed' (lib/onboarding-chase.ts, ticked from the existing 30-minute
-- loop in instrumentation.ts). `applicant_id` is the primary key, which is
-- also the DEDUPE key for "fires once": lib/onboarding-chase.ts checks for
-- any existing assistant_pending_actions row (any status — pending,
-- approved, cancelled, or failed) for this applicant before ever drafting a
-- second one, and only inserts a row HERE once the employer approves the
-- plan card, so a hire is chased at most once ever, not once per 30-minute
-- tick.
--
-- `plan` holds the complete approved artifact (day-one checklist, first-week
-- schedule, paperwork/e-sign list with dates, and the EXACT reminder message
-- texts) — the same "approve-what-you-see" principle as
-- assistant_ack_settings.template: the stored plan is byte-identical to what
-- the employer approved, and every candidate-facing reminder sent later
-- (via the existing assistant_send_queue) must match it exactly.
--
-- `status`: 'active' while reminders may still fire; 'complete' once the
-- employer (or a future onboarding-progress signal) ends it; 'expired' once
-- the 14-day backstop (ASSISTANT_ONBOARDING_CHASE_DAYS) fires with no
-- explicit completion. Both terminal states stop the chase the same way —
-- any still-queued assistant_send_queue rows for this plan's pending action
-- are cancelled the moment status leaves 'active'.
--
-- Same access pattern as every other assistant_*/job_* table in this
-- feature: service-role only, RLS on with no policies, explicit grants.
-- HAND-APPLIED, idempotent, safe to re-run.

create table if not exists public.onboarding_plans (
  applicant_id bigint primary key references public.applicants(id) on delete cascade,
  employer_id text not null,
  job_id bigint references public.job_postings(id) on delete set null,
  plan jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'complete', 'expired')),
  actor_user_id text not null,
  actor_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists onboarding_plans_employer_idx
  on public.onboarding_plans (employer_id);
create index if not exists onboarding_plans_status_idx
  on public.onboarding_plans (status);

alter table public.onboarding_plans enable row level security;

revoke all on public.onboarding_plans from public, anon, authenticated;
grant select, insert, update on public.onboarding_plans to service_role;
