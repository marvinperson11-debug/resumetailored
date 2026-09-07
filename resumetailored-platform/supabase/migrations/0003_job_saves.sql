-- Saved jobs for the Job Finder ("My Jobs"). One row per saved listing, scoped
-- by Clerk user_id. RLS on with no public policy — the server writes with the
-- service-role key and always scopes by the user_id it passes.
create table if not exists public.job_saves (
  id          bigint generated always as identity primary key,
  user_id     text        not null,
  job_data    jsonb       not null,
  created_at  timestamptz not null default now()
);
create index if not exists job_saves_user_created_idx on public.job_saves (user_id, created_at desc);
alter table public.job_saves enable row level security;
