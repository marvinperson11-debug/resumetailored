-- Employee Portal Phase 2 (Time): the workforce's time features, all raw-hours
-- only (no overtime, no wage math, no accrual balances). Five concerns:
--   1. Time clock — clock in/out entries with an optional note.
--   2. Timesheet reviews — one per (employee, ISO week) the employer
--      approves/declines.
--   3. Shifts — the employer posts a weekly grid per employee, then publishes.
--   4. Availability — the employee submits recurring + date-specific windows the
--      employer sees while scheduling.
--   5. Time-off requests — the employee requests dates + type; the employer
--      approves/declines; approved rows surface on the schedule.
--
-- Same service-role + employer_id-scoped pattern as 0029/0031 (employee hub &
-- portal): the server reads/writes with the service-role key; RLS owner-only is
-- defense in depth. `employer_id` is the Clerk user id (TEXT), so auth.uid() is
-- cast ::text. Every table references public.employees(id) with ON DELETE
-- CASCADE, so removing an employee removes their time data with them.
--
-- Weeks are ISO-ish but Monday-anchored: `week_start` is always the Monday
-- (YYYY-MM-DD) computed in the app layer (lib/time-hub.ts weekStartISO), so the
-- DB stores a plain date and never has to agree on a locale.
--
-- HAND-APPLIED: run this against the Supabase project before deploying. It is
-- idempotent (create ... if not exists / drop policy if exists), so it is safe
-- on a fresh or existing DB, and safe to re-run.

-- ── 1. Time clock entries ────────────────────────────────────────────────────
-- One row per clock-in. clock_out NULL means the entry is still open (the
-- employee is on the clock). A partial unique index guarantees at most one open
-- entry per employee, so a double clock-in can't create two.
create table if not exists public.time_entries (
  id bigint generated always as identity primary key,
  employer_id text not null,
  employee_id bigint not null references public.employees(id) on delete cascade,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists time_entries_employee_idx
  on public.time_entries (employer_id, employee_id, clock_in desc);
create unique index if not exists time_entries_one_open_idx
  on public.time_entries (employee_id)
  where clock_out is null;

alter table public.time_entries enable row level security;
drop policy if exists time_entries_owner on public.time_entries;
create policy time_entries_owner on public.time_entries
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

-- ── 2. Timesheet reviews (per employee, per week) ────────────────────────────
-- The employer's approve/decline decision for one employee's week. There is no
-- stored total — hours are summed live from time_entries — so a review is purely
-- the status + an optional note. status walks pending → approved | declined.
create table if not exists public.timesheet_reviews (
  id bigint generated always as identity primary key,
  employer_id text not null,
  employee_id bigint not null references public.employees(id) on delete cascade,
  week_start date not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employer_id, employee_id, week_start)
);
create index if not exists timesheet_reviews_week_idx
  on public.timesheet_reviews (employer_id, week_start);

alter table public.timesheet_reviews enable row level security;
drop policy if exists timesheet_reviews_owner on public.timesheet_reviews;
create policy timesheet_reviews_owner on public.timesheet_reviews
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

-- ── 3. Shifts (employer-posted schedule) ─────────────────────────────────────
-- One row per posted shift. start_time/end_time are 'HH:MM' 24h strings (no
-- timezone math — a shift is local to the workplace). published flips false →
-- true when the employer publishes that week; the employee's "My schedule" only
-- ever reads published shifts.
create table if not exists public.shifts (
  id bigint generated always as identity primary key,
  employer_id text not null,
  employee_id bigint not null references public.employees(id) on delete cascade,
  shift_date date not null,
  start_time text not null,
  end_time text not null,
  note text,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shifts_employer_week_idx
  on public.shifts (employer_id, shift_date);
create index if not exists shifts_employee_idx
  on public.shifts (employee_id, shift_date);

alter table public.shifts enable row level security;
drop policy if exists shifts_owner on public.shifts;
create policy shifts_owner on public.shifts
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

-- ── 4. Availability (employee-submitted) ─────────────────────────────────────
-- The employee tells the employer when they can work. `kind` is 'recurring'
-- (weekly, keyed by weekday 0=Sun..6=Sat) or 'date' (a single specific_date).
-- start_time/end_time are 'HH:MM'; `available` distinguishes an available window
-- (true) from a blocked one (false, e.g. "can't do Mondays"). Visible to the
-- employer on the scheduling view.
create table if not exists public.availability (
  id bigint generated always as identity primary key,
  employer_id text not null,
  employee_id bigint not null references public.employees(id) on delete cascade,
  kind text not null default 'recurring' check (kind in ('recurring', 'date')),
  weekday int check (weekday between 0 and 6),
  specific_date date,
  start_time text not null,
  end_time text not null,
  available boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists availability_employee_idx
  on public.availability (employer_id, employee_id);
create index if not exists availability_date_idx
  on public.availability (employer_id, specific_date)
  where specific_date is not null;

alter table public.availability enable row level security;
drop policy if exists availability_owner on public.availability;
create policy availability_owner on public.availability
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

-- ── 5. Time-off requests ─────────────────────────────────────────────────────
-- The employee requests a date range + type (vacation/sick/other) + reason; the
-- employer approves/declines with an optional note. No accrual balances — this
-- is purely a request/decision log. An approved row surfaces on the schedule for
-- the overlapping dates.
create table if not exists public.time_off_requests (
  id bigint generated always as identity primary key,
  employer_id text not null,
  employee_id bigint not null references public.employees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  kind text not null default 'vacation' check (kind in ('vacation', 'sick', 'other')),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  employer_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists time_off_employer_idx
  on public.time_off_requests (employer_id, status, start_date desc);
create index if not exists time_off_employee_idx
  on public.time_off_requests (employee_id, start_date desc);

alter table public.time_off_requests enable row level security;
drop policy if exists time_off_requests_owner on public.time_off_requests;
create policy time_off_requests_owner on public.time_off_requests
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);
