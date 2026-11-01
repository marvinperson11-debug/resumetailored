-- SMS + Background Checks (Part A) — SMS consent, captured once at
-- application time via a checkbox next to a versioned disclosure
-- (lib/sms-consent.ts `DISCLOSURE_VERSION`/`DISCLOSURE_TEXT`). Append-only
-- by convention (not enforced with a trigger like assistant_audit_log,
-- since a future "re-confirm consent" flow may legitimately insert a second
-- row for the same applicant — lib/sms-consent.ts `getLatestConsent` always
-- reads the most recent one).
--
-- No consent row for an applicant means exactly what it says: that
-- applicant (including every pre-existing applicant from before this
-- build, which gets no row and no backfill) cannot be sent SMS — see
-- lib/sms-consent.ts `isOptedIn`.
--
-- Same access pattern as every table created after the 2026-10-30 cutoff:
-- service-role only, RLS on with no policies, explicit grants. HAND-APPLIED,
-- idempotent, safe to re-run.

create table if not exists public.messaging_consents (
  id                 uuid primary key default gen_random_uuid(),
  employer_id        text not null,
  applicant_id       bigint not null references public.applicants(id) on delete cascade,
  phone_normalized   text not null,
  status             text not null check (status in ('opted_in', 'opted_out')),
  disclosure_version text not null,
  source             text not null default 'application',
  consented_at       timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

create index if not exists messaging_consents_applicant_idx on public.messaging_consents (applicant_id, created_at desc);
create index if not exists messaging_consents_employer_idx on public.messaging_consents (employer_id);
create index if not exists messaging_consents_phone_idx on public.messaging_consents (phone_normalized);

alter table public.messaging_consents enable row level security;

revoke all on public.messaging_consents from public, anon, authenticated;
grant select, insert on public.messaging_consents to service_role;
