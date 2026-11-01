-- SMS + Background Checks (Part A) — one US local number per org, provisioned
-- via the Twilio API (lib/twilio.ts `provisionLocalNumber`). `employer_id` is
-- the primary key, not just a unique index: the product only ever gives an
-- org ONE number (no team inbox, no per-seat number — out of scope per the
-- build prompt), so "the row for this org" and "the org's one number" are
-- the same lookup.
--
-- Same access pattern as every table created after the 2026-10-30 cutoff:
-- service-role only, RLS on with no policies, explicit grants. HAND-APPLIED,
-- idempotent, safe to re-run.

create table if not exists public.sms_numbers (
  employer_id  text primary key,
  phone_number text not null unique,
  twilio_sid   text,
  status       text not null default 'active' check (status in ('provisioning', 'active', 'error')),
  created_at   timestamptz not null default now()
);

alter table public.sms_numbers enable row level security;

revoke all on public.sms_numbers from public, anon, authenticated;
grant select, insert, update on public.sms_numbers to service_role;
