-- Application Tracker. One row per job the candidate has applied to, scoped by
-- Clerk user_id. RLS on with no public policy — the server writes with the
-- service-role key and always scopes by the user_id it passes.
create table if not exists public.applications (
  id            bigint generated always as identity primary key,
  user_id       text        not null,
  company       text        not null,
  role          text        not null,
  status        text        not null default 'Applied' check (status in ('Applied','Phone Screen','Interview','Offer','Rejected','Ghosted','Withdrawn')),
  contact_name  text,
  contact_email text,
  salary        text,
  location      text,
  url           text,
  notes         text,
  resume_id     text,
  follow_up_date date,
  applied_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists applications_user_applied_idx on public.applications (user_id, applied_at desc);
alter table public.applications enable row level security;
