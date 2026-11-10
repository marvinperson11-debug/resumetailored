-- Onboarding v1 (employer side) — links an employee row back to the
-- applicant it was hired from, and adds the two pieces of onboarding state
-- that didn't already have a table: the paperwork packet (W-4, I-9, direct
-- deposit) and the day-one task list.
--
-- `applicant_id` closes a real gap: `onboarding_plans` (0069) is keyed by
-- applicant_id, but nothing on `employees` pointed back to the applicant it
-- came from — the only link was matching email at employee-creation time
-- (lib/assistant-mutations.ts `executeOnboardingPlan`). The employer-side and
-- new-hire-side onboarding pages need to go EMPLOYEE -> PLAN, so the link is
-- made explicit and queryable. Nullable: an employee added by hand (never
-- hired through the pipeline) simply has no plan to show.
--
-- `onboarding_paperwork`: one row per (employee, kind). `kind` is 'w4', 'i9',
-- or 'direct_deposit' — the offer letter already lives in
-- `docusign_envelopes` and the handbook acknowledgment already lives in
-- `acknowledgments` (Training Library), so neither needs a row here.
-- Sensitive fields (bank account/routing numbers) are never stored in
-- `data`; they go in `enc_blob` (AES-256-GCM, lib/paperwork-crypto.ts) with
-- only the last 4 digits kept in the clear for display. V1 FILES NOTHING
-- WITH ANY GOVERNMENT AGENCY — this table is "collect it, keep it on file,"
-- never a submission.
--
-- `day_one_tasks`: a per-employee, per-task copy of the plan's day-one
-- checklist (lib/onboarding-plan.ts `dayOneChecklist`) so the employer can
-- actually check items off on day one — the plan itself only ever stores the
-- static text. Seeded once, lazily, the first time the onboarding page asks
-- for it (lib/day-one-tasks.ts `ensureDayOneTasks`).
--
-- Same service-role + employer_id-scoped pattern as every table in this
-- area. HAND-APPLIED, idempotent, safe to re-run.

alter table public.employees add column if not exists applicant_id bigint references public.applicants(id) on delete set null;
create index if not exists employees_applicant_idx on public.employees (applicant_id) where applicant_id is not null;

create table if not exists public.onboarding_paperwork (
  id bigint generated always as identity primary key,
  employer_id text not null,
  employee_id bigint not null references public.employees(id) on delete cascade,
  kind text not null check (kind in ('w4', 'i9', 'direct_deposit')),
  status text not null default 'not_started' check (status in ('not_started', 'submitted', 'verified')),
  data jsonb not null default '{}'::jsonb,
  enc_blob text,
  last4 text,
  submitted_at timestamptz,
  verified_at timestamptz,
  verified_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employer_id, employee_id, kind)
);
create index if not exists onboarding_paperwork_employee_idx on public.onboarding_paperwork (employer_id, employee_id);

alter table public.onboarding_paperwork enable row level security;
revoke all on public.onboarding_paperwork from public, anon, authenticated;
grant select, insert, update on public.onboarding_paperwork to service_role;

create table if not exists public.day_one_tasks (
  id bigint generated always as identity primary key,
  employer_id text not null,
  employee_id bigint not null references public.employees(id) on delete cascade,
  label text not null,
  done boolean not null default false,
  done_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists day_one_tasks_employee_idx on public.day_one_tasks (employer_id, employee_id, sort_order);

alter table public.day_one_tasks enable row level security;
revoke all on public.day_one_tasks from public, anon, authenticated;
grant select, insert, update on public.day_one_tasks to service_role;
