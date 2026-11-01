-- SMS + Background Checks — per-employer feature settings. This app has no
-- `organizations` table (an employer workspace is a Clerk user/org id, not a
-- Postgres row — see lib/employer-auth.ts); this is the small settings row
-- the build prompt's "organizations (sms_enabled, bgc_billing_mode)" extension
-- maps onto here.
--
-- `sms_enabled` flips on once a number has been provisioned for the org
-- (lib/twilio.ts `provisionLocalNumber`) — kept as its own flag rather than
-- inferring it from `sms_numbers` existing, so the Twilio-down path has a
-- single place to read "is SMS on for this org" without a join.
-- `bgc_billing_mode` is 'per_check' (pay at order time, card on file) for
-- every tier except Corporate, which may opt into 'invoiced'.
--
-- Same access pattern as every table created after the 2026-10-30 cutoff:
-- service-role only, RLS on with no policies, explicit grants. HAND-APPLIED,
-- idempotent, safe to re-run.

create table if not exists public.employer_settings (
  employer_id      text primary key,
  sms_enabled      boolean not null default false,
  bgc_billing_mode text not null default 'per_check' check (bgc_billing_mode in ('per_check', 'invoiced')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.employer_settings enable row level security;

revoke all on public.employer_settings from public, anon, authenticated;
grant select, insert, update on public.employer_settings to service_role;
