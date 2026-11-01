-- SMS + Background Checks (Part A/B) — `applicants.phone_normalized` is the
-- candidate identity the SMS feature keys on. `phone` keeps whatever the
-- candidate actually typed (for display); `phone_normalized` is the E.164
-- form (lib/sms-phone.ts `normalizePhoneE164`) the rest of the SMS feature
-- joins on, written only when normalization succeeds (NULL otherwise —
-- never a guessed or partial number).
--
-- HAND-APPLIED, idempotent, safe to re-run.

alter table public.applicants add column if not exists phone text;
alter table public.applicants add column if not exists phone_normalized text;

create index if not exists applicants_phone_normalized_idx on public.applicants (phone_normalized);
