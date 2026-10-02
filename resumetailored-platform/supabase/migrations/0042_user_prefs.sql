-- 0042 — user_prefs: per-user standing preferences, starting with custom
-- writing instructions that are applied to every resume / cover-letter
-- tailoring run (app/api/tailor, app/api/cover-letter).
--
-- Identity is Clerk's, so user_id is a Clerk user id (text). The Next.js server
-- reads/writes with the service-role key, which bypasses RLS; RLS is enabled
-- with no policy so anon/authenticated clients get nothing.
--
-- HAND-APPLIED, idempotent, safe to re-run. The app tolerates the table being
-- absent (reads return "no instructions"; saves return a clear 503), so the
-- order of deploy vs. running this does not matter — until it is applied,
-- tailoring behaves exactly as before.

create table if not exists public.user_prefs (
  user_id             text        primary key,
  custom_instructions text        not null default '',
  updated_at          timestamptz not null default now()
);

alter table public.user_prefs enable row level security;
