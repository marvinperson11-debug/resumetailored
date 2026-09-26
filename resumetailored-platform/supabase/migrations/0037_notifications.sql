-- In-app notification bells (both sides).
--
-- `activity_events` is the persisted event log the bells read from — nothing
-- like it existed before (the employer dashboard's "Recent activity" panel is
-- computed live from other tables on each page load, not stored). Each row
-- targets ONE audience: the employer workspace itself (`audience = 'employer'`,
-- `employee_id` null — visible to the account owner and any team member with
-- employer-portal access), or one specific employee's own portal
-- (`audience = 'employee'`, `employee_id` set). A broadcast (e.g. an
-- announcement, for every active employee) is simply one row per employee —
-- same denormalized-fanout shape `acknowledgments` already uses.
--
-- `notification_reads` is a per-(reader, event) mark, exactly as specced:
-- `user_id` is the Clerk id of whoever read it — the employer's own userId,
-- or the employee's own clerk_user_id — so teammates sharing one employer
-- workspace each get their own read state on the same shared event.
--
-- Same service-role + employer_id-scoped RLS pattern as every other table
-- here. HAND-APPLIED, idempotent, safe to re-run.

create table if not exists public.activity_events (
  id bigint generated always as identity primary key,
  employer_id text not null,
  audience text not null default 'employer', -- 'employer' | 'employee'
  employee_id bigint references public.employees(id) on delete cascade,
  event_type text not null,
  title text not null,
  body text,
  link text not null,
  created_at timestamptz not null default now()
);
create index if not exists activity_events_employer_idx on public.activity_events (employer_id, created_at desc);
create index if not exists activity_events_employee_idx on public.activity_events (employee_id, created_at desc);

alter table public.activity_events enable row level security;
drop policy if exists activity_events_owner on public.activity_events;
create policy activity_events_owner on public.activity_events
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

create table if not exists public.notification_reads (
  user_id text not null,
  event_id bigint not null references public.activity_events(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, event_id)
);
create index if not exists notification_reads_event_idx on public.notification_reads (event_id);

-- No owner-column RLS here (there's no employer_id on this table) — reachable
-- only through the service-role key, same as the platform-content tables
-- (e.g. training_library_items in 0030).
alter table public.notification_reads enable row level security;
