-- SMS + Background Checks (Part A) — the conversation/message store behind
-- the employer portal's SMS inbox (lib/sms-store.ts).
--
-- One conversation per (employer_id, applicant_id) — `unique(employer_id,
-- applicant_id)` is what makes lib/sms-store.ts `getOrCreateConversation`
-- idempotent (a second inbound/outbound message for the same pair reuses
-- the row instead of forking the thread).
--
-- `segments` on sms_messages is the GSM-7/UCS-2 segment count
-- (lib/sms-phone.ts `countSegments`) at SEND time for an outbound message —
-- what metering (lib/sms-quota.ts) actually bills against; an inbound
-- message's segments is informational only (inbound isn't metered).
--
-- `provider_message_sid` is Twilio's own message SID, used to match a
-- status-callback webhook back to a row (lib/webhook-idempotency.ts is the
-- actual dedupe guard; this index just makes the UPDATE a cheap lookup, not
-- a second idempotency mechanism).
--
-- Same access pattern as every table created after the 2026-10-30 cutoff:
-- service-role only, RLS on with no policies, explicit grants. HAND-APPLIED,
-- idempotent, safe to re-run.

create table if not exists public.sms_conversations (
  id              uuid primary key default gen_random_uuid(),
  employer_id     text not null,
  applicant_id    bigint not null references public.applicants(id) on delete cascade,
  phone_normalized text not null,
  last_message_at timestamptz,
  unread_count    integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (employer_id, applicant_id)
);

create index if not exists sms_conversations_employer_idx on public.sms_conversations (employer_id, last_message_at desc);
create index if not exists sms_conversations_phone_idx on public.sms_conversations (phone_normalized);

create table if not exists public.sms_messages (
  id                   uuid primary key default gen_random_uuid(),
  conversation_id      uuid not null references public.sms_conversations(id) on delete cascade,
  employer_id          text not null,
  direction            text not null check (direction in ('outbound', 'inbound')),
  body                 text not null,
  segments             integer not null default 1,
  status               text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'received')),
  queue_reason         text check (queue_reason in ('cap', 'quiet_hours')),
  provider_message_sid text,
  actor_user_id        text,
  scheduled_at         timestamptz,
  sent_at              timestamptz,
  delivered_at         timestamptz,
  failed_reason        text,
  created_at           timestamptz not null default now()
);

create index if not exists sms_messages_conversation_idx on public.sms_messages (conversation_id, created_at);
create index if not exists sms_messages_sid_idx on public.sms_messages (provider_message_sid);
create index if not exists sms_messages_queued_idx on public.sms_messages (status, scheduled_at) where status = 'queued';

alter table public.sms_conversations enable row level security;
alter table public.sms_messages enable row level security;

revoke all on public.sms_conversations from public, anon, authenticated;
revoke all on public.sms_messages from public, anon, authenticated;
grant select, insert, update on public.sms_conversations to service_role;
grant select, insert, update on public.sms_messages to service_role;
