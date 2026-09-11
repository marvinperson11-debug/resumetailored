-- Career Hub — persistent goals, milestones, and a single profile per user.
-- Server writes with the service-role key; RLS on to lock out anon/auth clients.
create table if not exists public.career_goals (
  id          bigint generated always as identity primary key,
  user_id     text        not null,
  title       text        not null,
  category    text        not null default 'skill',
  priority    text        not null default 'medium',
  target_date date,
  status      text        not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  progress    int         not null default 0 check (progress >= 0 and progress <= 100),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists career_goals_user_status_idx on public.career_goals (user_id, status, target_date);

create table if not exists public.career_milestones (
  id          bigint generated always as identity primary key,
  user_id     text        not null,
  type        text        not null,
  title       text        not null,
  date        date        not null,
  description text,
  impact      text,
  created_at  timestamptz not null default now()
);
create index if not exists career_milestones_user_date_idx on public.career_milestones (user_id, date desc);

create table if not exists public.career_profiles (
  user_id          text        not null primary key,
  current_role     text,
  target_role      text,
  industry         text,
  years_experience int,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.career_goals enable row level security;
alter table public.career_milestones enable row level security;
alter table public.career_profiles enable row level security;
