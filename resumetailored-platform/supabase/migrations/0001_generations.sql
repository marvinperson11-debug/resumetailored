-- Generations: everything the candidate tools produce (tailored resumes, cover
-- letters, ATS scans). Drives the dashboard stat cards. Identity is Clerk's, so
-- user_id is a Clerk user id (text) and the server writes with the service-role
-- key. RLS is enabled with no public policy: only the service role (which the
-- Next.js server uses) can read/write, and it bypasses RLS.

create table if not exists public.generations (
  id          bigint generated always as identity primary key,
  user_id     text        not null,
  tool_type   text        not null check (tool_type in ('resume', 'cover_letter', 'ats')),
  content     jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists generations_user_created_idx
  on public.generations (user_id, tool_type, created_at desc);

alter table public.generations enable row level security;
-- No policies → anon/authenticated clients get nothing; the server service-role
-- key bypasses RLS. Add a policy later if you wire Supabase Auth to Clerk.
