-- Employer Portal AI Assistant — append-only audit log (Phase 0 foundation).
--
-- Every tool call the assistant makes (read-only in this phase; mutating tools
-- in later phases reuse this same table) is written here BEFORE and/or after
-- execution so "what did the assistant do, for which employer, as which user"
-- is always answerable. `payload_json` holds the tool's inputs (never free-text
-- chat content — see lib/assistant-audit.ts).
--
-- Service-role only, same pattern as guest_quotas/notification_reads: RLS is
-- on with no policies, since every real read is scoped by employer_id in the
-- query layer (lib/assistant-audit.ts `listActions`), not by a Postgres policy.
--
-- Append-only is enforced with a trigger rather than just an app-level
-- convention: UPDATE and DELETE are rejected for every role, including the
-- service role, so a compromised or buggy server process still cannot rewrite
-- history. HAND-APPLIED, idempotent, safe to re-run.

create table if not exists public.assistant_audit_log (
  id uuid primary key default gen_random_uuid(),
  employer_id text not null,
  actor_user_id text not null,
  actor_email text,
  action text not null,
  target_type text,
  target_id text,
  payload_json jsonb not null default '{}'::jsonb,
  status text not null default 'executed' check (status in ('executed', 'failed')),
  created_at timestamptz not null default now()
);
create index if not exists assistant_audit_log_employer_idx
  on public.assistant_audit_log (employer_id, created_at desc);

alter table public.assistant_audit_log enable row level security;

create or replace function public.assistant_audit_log_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'assistant_audit_log is append-only: % is not permitted', tg_op;
end;
$$;

drop trigger if exists assistant_audit_log_no_update on public.assistant_audit_log;
create trigger assistant_audit_log_no_update
  before update on public.assistant_audit_log
  for each row execute function public.assistant_audit_log_block_mutation();

drop trigger if exists assistant_audit_log_no_delete on public.assistant_audit_log;
create trigger assistant_audit_log_no_delete
  before delete on public.assistant_audit_log
  for each row execute function public.assistant_audit_log_block_mutation();
