-- Employer Portal AI Assistant — pending mutating actions (Prompt 2).
--
-- A mutating Assistant tool (lib/assistant-tools.ts) NEVER executes inside
-- the chat turn. Its executor only writes a row here with the exact artifact
-- the confirmation card will render (docs/assistant-confirmation-card.md)
-- and hands the id back to the chat; the real mutation happens only when a
-- human approves it (app/api/employer/assistant/actions/[id]/approve). This
-- row's own `id` IS the idempotency key: approving a second time finds a row
-- whose status is no longer 'pending' and reports that status instead of
-- re-executing (lib/assistant-mutations.ts `approvePendingAction`).
--
-- Same access pattern as assistant_audit_log (migration 0051): service-role
-- only. RLS is on with no policies — every real read/write is scoped by
-- employer_id in the query layer (lib/assistant-pending.ts), not by a
-- Postgres policy. Supabase is ending its automatic public-schema grant to
-- API roles on 2026-10-30 (this table lands right at that cutoff), so the
-- grants below are explicit rather than relied-upon. HAND-APPLIED, idempotent,
-- safe to re-run.

create table if not exists public.assistant_pending_actions (
  id uuid primary key default gen_random_uuid(),
  employer_id text not null,
  actor_user_id text not null,
  action text not null,
  payload_json jsonb not null default '{}'::jsonb,
  artifact_json jsonb not null default '{}'::jsonb,
  irreversible boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'executed', 'cancelled', 'failed')),
  failure_reason text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists assistant_pending_actions_employer_idx
  on public.assistant_pending_actions (employer_id, status, created_at desc);

alter table public.assistant_pending_actions enable row level security;

revoke all on public.assistant_pending_actions from public, anon, authenticated;
grant select, insert, update on public.assistant_pending_actions to service_role;
