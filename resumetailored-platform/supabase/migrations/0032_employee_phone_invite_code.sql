-- Phase 1 follow-up: employee phone (optional, sets up SMS later) + a 6-digit
-- invite code that gates portal acceptance alongside the emailed link.
--
-- Same employer_id-scoped `employees` table as 0029/0031. HAND-APPLIED: run this
-- against the Supabase project before deploying. Idempotent (add column if not
-- exists), safe on a fresh or existing DB, and safe to re-run.

-- Optional contact number. Editable in the employee form; not used for delivery
-- yet — SMS invite delivery is a future PR (needs a provider). The invite code
-- travels in the email for now.
alter table public.employees add column if not exists phone text;

-- One-time 6-digit acceptance code, set when an invite is (re)generated and
-- cleared on acceptance. Required at /employee/accept in addition to the
-- signed-in email matching the invited address.
alter table public.employees add column if not exists invite_code text;
