-- Interview Coach mock-interview sessions (history + stats). The server writes
-- with the service-role key; RLS on to keep any anon/auth client locked out.
create table if not exists public.interview_sessions (
  id              bigint generated always as identity primary key,
  user_id         text        not null,
  job_description text,
  resume_text     text,
  interview_type  text        not null default 'behavioral',
  difficulty      text        not null default 'mid',
  questions       jsonb       not null default '[]'::jsonb,
  answers         jsonb       not null default '[]'::jsonb,
  overall_score   int,
  report          jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists interview_sessions_user_created_idx on public.interview_sessions (user_id, created_at desc);
alter table public.interview_sessions enable row level security;
