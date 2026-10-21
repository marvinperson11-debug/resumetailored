-- Employer Portal AI Assistant — inbound-email idempotency (Prompt 3).
--
-- A provider retries webhook deliveries; replying to a reminder email must
-- never create two pending reschedule actions for the one reply. This table
-- is the dedupe key: lib/assistant-inbound.ts INSERTs a row keyed on the
-- provider's own message id BEFORE doing any LLM work or creating a pending
-- action, and treats a unique-violation on that insert as "already
-- processed" — the same optimistic-claim shape
-- assistant_pending_actions.status='pending' uses for approval (see
-- lib/assistant-pending.ts claimForExecution), just keyed on a different
-- column. `outcome`/`interview_id`/`pending_action_id` are filled in after
-- processing, for support/debugging — they are never read back to decide
-- idempotency (the UNIQUE constraint on provider_message_id is what decides
-- that).
--
-- Same access pattern as every other assistant_* table (0051/0052/0053):
-- service-role only, RLS on with no policies, explicit grants (new tables
-- created after the 2026-10-30 cutoff get no automatic Data API grants).
-- HAND-APPLIED, idempotent, safe to re-run.

create table if not exists public.assistant_inbound_events (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null,
  interview_id bigint,
  outcome text,
  pending_action_id uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists assistant_inbound_events_provider_msg_idx
  on public.assistant_inbound_events (provider_message_id);

alter table public.assistant_inbound_events enable row level security;

revoke all on public.assistant_inbound_events from public, anon, authenticated;
grant select, insert, update on public.assistant_inbound_events to service_role;
