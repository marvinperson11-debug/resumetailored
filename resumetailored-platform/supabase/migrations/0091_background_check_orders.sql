-- SMS + Background Checks (Part B) — Checkr-backed background checks
-- (lib/bgc-store.ts) + the FCRA two-step adverse-action workflow
-- (lib/adverse-action.ts).
--
-- Zero PII beyond what we already have (name/email/phone on `applicants`)
-- touches this table: no SSN, no DOB. `checkr_*_id` columns are Checkr's own
-- opaque ids; `result` is just the clear/consider summary, never report
-- contents (the full report stays on Checkr's hosted deep link).
--
-- `price_cents` is OUR price (Checkr cost + 15%, lib/bgc-packages.ts
-- `priceForPackage`) at order time — stored, not recomputed later, so a
-- subsequent price-table change never rewrites what the employer was
-- actually charged. `pass_through_fee_cents` is the itemized court/county
-- fee, billed at cost with no margin.
--
-- Same access pattern as every table created after the 2026-10-30 cutoff:
-- service-role only, RLS on with no policies, explicit grants. HAND-APPLIED,
-- idempotent, safe to re-run.

create table if not exists public.background_check_orders (
  id                     uuid primary key default gen_random_uuid(),
  employer_id            text not null,
  applicant_id           bigint not null references public.applicants(id) on delete cascade,
  package                text not null check (package in ('basic', 'standard', 'premium')),
  checkr_candidate_id    text,
  checkr_invitation_id   text,
  checkr_report_id       text,
  status                 text not null default 'ordered' check (status in (
                           'ordered', 'invitation_sent', 'candidate_completed', 'report_pending',
                           'completed', 'suspended', 'disputed', 'canceled'
                         )),
  result                 text check (result in ('clear', 'consider')),
  price_cents            integer not null,
  pass_through_fee_cents integer not null default 0,
  billing_mode           text not null default 'per_check' check (billing_mode in ('per_check', 'invoiced')),
  fair_chance_warning    boolean not null default false,
  ordered_by             text not null,
  ordered_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists background_check_orders_employer_idx on public.background_check_orders (employer_id, ordered_at desc);
create index if not exists background_check_orders_applicant_idx on public.background_check_orders (applicant_id);
create unique index if not exists background_check_orders_checkr_report_idx on public.background_check_orders (checkr_report_id) where checkr_report_id is not null;

create table if not exists public.adverse_action_events (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.background_check_orders(id) on delete cascade,
  employer_id    text not null,
  stage          text not null check (stage in ('pre_adverse_sent', 'waiting', 'adverse_notice_sent', 'canceled')),
  wait_until     timestamptz,
  actor_user_id  text not null,
  created_at     timestamptz not null default now()
);

create index if not exists adverse_action_events_order_idx on public.adverse_action_events (order_id, created_at desc);

alter table public.background_check_orders enable row level security;
alter table public.adverse_action_events enable row level security;

revoke all on public.background_check_orders from public, anon, authenticated;
revoke all on public.adverse_action_events from public, anon, authenticated;
grant select, insert, update on public.background_check_orders to service_role;
grant select, insert on public.adverse_action_events to service_role;
