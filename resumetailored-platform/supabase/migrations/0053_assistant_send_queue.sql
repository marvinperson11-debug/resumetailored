-- Employer Portal AI Assistant — delayed candidate-message send queue (Prompt 2).
--
-- A message_candidates mutation, once approved, is never sent inline: it is
-- enqueued here with send_at = approval time + ASSISTANT_UNDO_WINDOW_SECONDS
-- (default 60s), giving the employer a last chance to catch a mistake before
-- anything reaches the candidate (lib/assistant-send-worker.ts, ticked from
-- instrumentation.ts). Approval is the authorization event; the delay is a
-- safety valve, not a second decision — the worker only ever sends a row
-- whose pending action already has status = 'executed'.
--
-- Same access pattern as assistant_pending_actions / assistant_audit_log:
-- service-role only, RLS on with no policies, explicit grants (see 0052 for
-- why these are explicit rather than relied-upon after 2026-10-30).
-- HAND-APPLIED, idempotent, safe to re-run.

create table if not exists public.assistant_send_queue (
  id uuid primary key default gen_random_uuid(),
  pending_action_id uuid not null references public.assistant_pending_actions(id),
  employer_id text not null,
  candidate_id bigint not null,
  body text not null,
  send_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'cancelled', 'failed')),
  sent_at timestamptz
);

create index if not exists assistant_send_queue_due_idx
  on public.assistant_send_queue (status, send_at);
create index if not exists assistant_send_queue_pending_action_idx
  on public.assistant_send_queue (pending_action_id);

alter table public.assistant_send_queue enable row level security;

revoke all on public.assistant_send_queue from public, anon, authenticated;
grant select, insert, update on public.assistant_send_queue to service_role;
