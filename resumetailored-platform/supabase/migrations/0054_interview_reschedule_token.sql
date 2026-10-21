-- Employer Portal AI Assistant — reply-by-email reschedule (Prompt 3).
--
-- `reschedule_token_hash` is a verification cache for the tokenized Reply-To
-- lib/interview-reminders.ts now puts on every 24h/2h reminder email
-- (resc-{id}-{token}@INBOUND_EMAIL_DOMAIN) — see lib/assistant-reschedule.ts
-- for why the token itself is derived (HMAC) rather than stored: this column
-- lets the inbound webhook verify a reply without recomputing the HMAC in a
-- second place. Null until the first reminder for an interview is actually
-- sent with the feature configured.
--
-- `candidate_comms_optout` is set when a candidate replies "stop" to a
-- reminder; lib/interview-reminders.ts checks it before sending (or deriving
-- a Reply-To for) any further reminder on that interview.
--
-- Pure ALTER TABLE on an existing table (no new grants needed — same
-- precedent as 0050_interview_reminders.sql, which added the two reminder
-- flags to this same table without touching its grants). HAND-APPLIED,
-- idempotent, safe to re-run.

alter table public.interviews add column if not exists reschedule_token_hash text;
alter table public.interviews add column if not exists candidate_comms_optout boolean not null default false;
