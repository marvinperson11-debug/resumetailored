-- LinkedIn Optimizer analyses — stat tracking + history. The server writes with
-- the service-role key (RLS on; policies are irrelevant to the service role but
-- keep the table locked down for any anon/auth client).
create table if not exists public.linkedin_analyses (
  id           bigint generated always as identity primary key,
  user_id      text        not null,
  profile_text text,
  score        int         not null default 0,
  suggestions  jsonb       not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists linkedin_analyses_user_created_idx on public.linkedin_analyses (user_id, created_at desc);
alter table public.linkedin_analyses enable row level security;
