-- SMS + Background Checks (Part A) — the GLOBAL SMS suppression list,
-- keyed only on the E.164 phone number (never on employer_id or an
-- applicant id). A STOP replied to any one org's number suppresses that
-- number platform-wide — see lib/sms-consent.ts for why that is the
-- conservative, spec-literal reading of "our own suppression list keyed on
-- E.164 phone", and how it makes "opt-out survives record merges" true for
-- free (the table was never keyed on a record id to begin with).
--
-- Upserted on `phone_normalized` (lib/sms-consent.ts `recordOptOut`), so a
-- repeat STOP from an already-suppressed number is a harmless no-op, not a
-- duplicate-key error.
--
-- Same access pattern as every table created after the 2026-10-30 cutoff:
-- service-role only, RLS on with no policies, explicit grants. HAND-APPLIED,
-- idempotent, safe to re-run.

create table if not exists public.sms_opt_outs (
  phone_normalized text primary key,
  source           text not null default 'stop_keyword',
  opted_out_at     timestamptz not null default now()
);

alter table public.sms_opt_outs enable row level security;

revoke all on public.sms_opt_outs from public, anon, authenticated;
grant select, insert, update, delete on public.sms_opt_outs to service_role;
