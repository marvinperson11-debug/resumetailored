-- Employer Portal AI Assistant — auto-acknowledgment idempotency (Prompt 4).
--
-- lib/assistant-ack-worker.ts's 15s scan only ever picks up an applicant row
-- while this is null, and stamps it the moment the send is handed off — the
-- same "flip the status before the real work finishes" shape
-- assistant_pending_actions uses (see lib/assistant-pending.ts
-- `claimForExecution`), so two overlapping ticks can't double-send.
--
-- Pure ALTER TABLE on an existing table — same no-new-grants precedent as
-- 0054/0055/0058/0059/0060. HAND-APPLIED, idempotent, safe to re-run.

alter table public.applicants add column if not exists ack_sent_at timestamptz;
