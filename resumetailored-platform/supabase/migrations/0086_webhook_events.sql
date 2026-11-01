-- SMS + Background Checks — generic webhook-delivery idempotency, shared by
-- the Twilio status-callback webhook and the Checkr webhook (both retry on
-- a timeout or non-2xx, same shape lib/assistant-inbound.ts's
-- `assistant_inbound_events` already solves for inbound email/SMS). One
-- table rather than two: the only thing either handler needs is "has this
-- (provider, event_id) pair been claimed before", and `provider` already
-- disambiguates the two id spaces, so no per-provider table was needed. See
-- lib/webhook-idempotency.ts.
--
-- Same access pattern as every table created after the 2026-10-30 cutoff:
-- service-role only, RLS on with no policies, explicit grants. HAND-APPLIED,
-- idempotent, safe to re-run.

create table if not exists public.provider_webhook_events (
  id         uuid primary key default gen_random_uuid(),
  provider   text not null,
  event_id   text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists provider_webhook_events_provider_event_idx
  on public.provider_webhook_events (provider, event_id);

alter table public.provider_webhook_events enable row level security;

revoke all on public.provider_webhook_events from public, anon, authenticated;
grant select, insert on public.provider_webhook_events to service_role;
