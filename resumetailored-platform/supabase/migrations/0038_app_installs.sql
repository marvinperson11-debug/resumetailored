-- Admin install notifications (PWA, item 4).
--
-- Not employer-scoped: an install can come from a candidate, an employer, or
-- a workforce employee, and an anonymous visitor is possible in principle
-- (the "Download the app" button on the sign-in page). RLS is enabled with NO
-- owner policy — reachable only through the service-role key, same pattern as
-- the platform-content tables (training_library_items in 0030,
-- notification_reads in 0037).
--
-- HAND-APPLIED, idempotent, safe to re-run.

create table if not exists public.app_installs (
  id bigint generated always as identity primary key,
  user_id text,
  email text,
  platform text not null default 'unknown',
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists app_installs_created_idx on public.app_installs (created_at desc);

alter table public.app_installs enable row level security;
