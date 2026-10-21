-- Employer Portal AI Assistant — Resend inbound-email adapter (Prompt 4).
--
-- Resend's "email.received" webhook identifies a delivery by its own
-- `email_id`, a different id space from the generic `provider_message_id`
-- column (migration 0056) the original provider-agnostic inbound path
-- (SendGrid/Mailgun/Postmark field-name sniffing in
-- lib/assistant-inbound.ts `parseInboundPayload`) already dedupes on. Rather
-- than repurpose that column for a differently-shaped id, this adds a
-- second, nullable, uniquely-indexed column so EITHER dedupe key can claim a
-- row — a Resend delivery claims by resend_email_id
-- (lib/assistant-resend-inbound.ts), everything else keeps claiming by
-- provider_message_id exactly as before, and a row from either path is still
-- exactly one row (see lib/assistant-inbound.ts `claimInboundEventKey`).
--
-- Same access pattern as every other assistant_* table: service-role only,
-- RLS already on with no policies, no new grants needed for an ALTER on an
-- existing table (same precedent as 0054/0055). HAND-APPLIED, idempotent,
-- safe to re-run.

alter table public.assistant_inbound_events add column if not exists resend_email_id text;

create unique index if not exists assistant_inbound_events_resend_email_idx
  on public.assistant_inbound_events (resend_email_id)
  where resend_email_id is not null;
