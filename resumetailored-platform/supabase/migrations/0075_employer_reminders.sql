-- Employer Portal AI Assistant — employer-internal reminders (Taylor Combined
-- Build v5, Section B).
--
-- A reminder the employer asks the assistant to set for THEMSELVES (e.g.
-- "remind me to follow up with Maria on Friday") — never candidate-facing,
-- so unlike every mutating tool in lib/assistant-tools.ts this never goes
-- through assistant_pending_actions (migration 0052): set_reminder/
-- cancel_reminder execute directly, no confirmation card, because nothing
-- here is irreversible or visible to anyone outside this employer's own
-- workspace (lib/assistant-tools.ts, "direct execution" tools).
--
-- `fired_at` is the single idempotency guard the 15s scan
-- (lib/reminder-cron.ts `runReminderScan`) relies on: a reminder is only
-- ever claimed by an UPDATE that filters on `fired_at is null`, so two
-- overlapping ticks (or a retried tick) can never fire the same row twice.
-- `status` stays a separate column (rather than inferring "fired" from
-- `fired_at` alone) so a CANCELLED reminder is distinguishable from one that
-- simply hasn't come due yet, and so list_reminders can filter cleanly.
--
-- Same access pattern as every other Assistant table (assistant_audit_log,
-- assistant_pending_actions, …): service-role only, RLS on with no
-- policies — every real read/write is scoped by employer_id in the query
-- layer (lib/employer-reminders.ts), not by a Postgres policy. Grants are
-- explicit per the Oct 30, 2026 cutoff (new public tables get no automatic
-- Data API grants, not even service_role). HAND-APPLIED, idempotent, safe
-- to re-run.

create table if not exists public.employer_reminders (
  id uuid primary key default gen_random_uuid(),
  employer_id text not null,
  actor_user_id text not null,
  actor_email text,
  title text not null,
  note text,
  due_at timestamptz not null,
  target_type text,
  target_id text,
  status text not null default 'pending' check (status in ('pending', 'fired', 'cancelled')),
  fired_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists employer_reminders_employer_idx
  on public.employer_reminders (employer_id, status, due_at);
-- The 15s scan's own scan key: every employer's due, unfired, still-pending
-- reminders, independent of which employer owns them.
create index if not exists employer_reminders_due_idx
  on public.employer_reminders (due_at) where status = 'pending' and fired_at is null;

alter table public.employer_reminders enable row level security;

revoke all on public.employer_reminders from public, anon, authenticated;
grant select, insert, update on public.employer_reminders to service_role;
