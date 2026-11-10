-- Onboarding v1's Corporate-tier extras, deferred from 0096: handbook
-- versioning, and the dedupe table behind Taylor's Scale+ overdue nudge.
--
-- `training_docs.version` / `acknowledgments.doc_version` — the handbook
-- (a `policy` + require_signature + assign_to='all' TrainingDoc, see
-- lib/handbook.ts) has no in-place edit route today: REPLACING its content
-- is a real update (lib/training-store.ts `replaceTrainingDocContent`,
-- Corporate-only, lib/employer-plan.ts `canManageHandbookVersions`) that
-- bumps `version` on the SAME row, rather than the generic Training tab's
-- delete-then-recreate (which would cascade-delete every past
-- acknowledgment and lose the signing history entirely). `doc_version` is
-- stamped onto an acknowledgment at the moment it is actually marked
-- signed (owner override, DocuSign webhook, employee self-mark-complete, or
-- a passing quiz attempt) — never read live off the doc at display time —
-- so a later handbook replacement never retroactively changes what a past
-- hire is shown as having signed.
--
-- `onboarding_overdue_nudges` — one row per employee, the idempotency guard
-- for Taylor's Scale+ "nudge the employer on overdue items" scan
-- (lib/onboarding-chase.ts `runOnboardingOverdueNudgeScan`, ticked
-- alongside the existing completion/expiry scans). Without this, a hire who
-- stays overdue would get re-nudged every 30-minute tick; `last_nudged_at`
-- caps it at one nudge per 24h while something stays outstanding.
--
-- Same service-role + employer_id-scoped pattern as every table in this
-- area. HAND-APPLIED, idempotent, safe to re-run.

alter table public.training_docs add column if not exists version int not null default 1;
alter table public.acknowledgments add column if not exists doc_version int;

create table if not exists public.onboarding_overdue_nudges (
  employee_id bigint primary key references public.employees(id) on delete cascade,
  employer_id text not null,
  last_nudged_at timestamptz not null,
  overdue_summary text,
  created_at timestamptz not null default now()
);
create index if not exists onboarding_overdue_nudges_employer_idx on public.onboarding_overdue_nudges (employer_id);

alter table public.onboarding_overdue_nudges enable row level security;
revoke all on public.onboarding_overdue_nudges from public, anon, authenticated;
grant select, insert, update on public.onboarding_overdue_nudges to service_role;
