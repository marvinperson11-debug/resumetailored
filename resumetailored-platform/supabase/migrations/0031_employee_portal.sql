-- Employee Portal Foundation (Phase 1): give the employer's workforce their own
-- signed-in portal at /employee. Three concerns:
--   1. Link an `employees` row to a Clerk account (invite → signup → linked).
--   2. Employee ↔ employer direct messages.
--   3. Employer announcements broadcast to every invited employee's portal home.
--
-- Same service-role + employer_id-scoped pattern as 0027 (documents) and 0029
-- (employee hub): the server reads/writes with the service-role key; RLS
-- owner-only is defense in depth. `employer_id` is the Clerk user id (TEXT), so
-- auth.uid() is cast ::text.
--
-- HAND-APPLIED: run this against the Supabase project before deploying. It is
-- idempotent (create ... if not exists / add column if not exists / drop policy
-- if exists), so it is safe on a fresh or existing DB, and safe to re-run.

-- ── 1. Employee ↔ Clerk account link + invite lifecycle ──────────────────────
-- clerk_user_id is the invited employee's Clerk id once they accept (NULL until
-- then). invite_token is the one-time acceptance token carried by the emailed
-- link; invite_status walks none → invited → accepted. Kept on the employees
-- row (not a separate table) so the directory shows invite state inline.
alter table public.employees add column if not exists clerk_user_id text;
alter table public.employees add column if not exists invite_token text;
alter table public.employees add column if not exists invite_status text not null default 'none';
alter table public.employees add column if not exists invited_at timestamptz;
alter table public.employees add column if not exists linked_at timestamptz;

-- One Clerk account maps to at most one employee row per employer. A partial
-- unique index (NULLs excluded) lets many rows stay unlinked without colliding.
create unique index if not exists employees_clerk_user_idx
  on public.employees (employer_id, clerk_user_id)
  where clerk_user_id is not null;
create index if not exists employees_invite_token_idx
  on public.employees (invite_token)
  where invite_token is not null;

-- ── 2. Employee messages ─────────────────────────────────────────────────────
-- A single thread per (employer, employee). `sender` is 'employer' or 'employee';
-- read_at marks when the *other* side has seen it (used for unread counts on
-- both portals). Scoped by employer_id like every other employer table.
create table if not exists public.employee_messages (
  id bigint generated always as identity primary key,
  employer_id text not null,
  employee_id bigint not null references public.employees(id) on delete cascade,
  sender text not null check (sender in ('employer', 'employee')),
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists employee_messages_thread_idx
  on public.employee_messages (employer_id, employee_id, created_at);

alter table public.employee_messages enable row level security;
drop policy if exists employee_messages_owner on public.employee_messages;
create policy employee_messages_owner on public.employee_messages
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

-- ── 3. Announcements ─────────────────────────────────────────────────────────
-- Employer broadcasts. `pinned` announcements surface at the top of every
-- invited employee's portal home. `active` lets an employer retire one without
-- deleting the record. Employees read them through the service-role store,
-- scoped to their own employer_id, so no employee-facing RLS policy is needed.
create table if not exists public.announcements (
  id bigint generated always as identity primary key,
  employer_id text not null,
  title text not null,
  body text not null default '',
  pinned boolean not null default true,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists announcements_employer_idx
  on public.announcements (employer_id, created_at desc);

alter table public.announcements enable row level security;
drop policy if exists announcements_owner on public.announcements;
create policy announcements_owner on public.announcements
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);
