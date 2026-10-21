-- Employer Portal AI Assistant — candidate-level comms opt-out (Prompt 4).
--
-- `interviews.candidate_comms_optout` (migration 0053-era) only suppresses
-- INTERVIEW reminders for one interview. The runner-up pool
-- (lib/assistant-runner-up.ts) and the auto-ack worker
-- (lib/assistant-ack-worker.ts) both re-approach or message a candidate
-- outside the context of any one interview, so they need an opt-out that
-- travels with the CANDIDATE (the applicant row), not a single interview.
-- lib/assistant-inbound.ts's "stop" handling now sets BOTH columns — the
-- interview-level flag for the existing reminder path, and this one for
-- every other assistant-initiated candidate-facing send.
--
-- Pure ALTER TABLE on an existing table — same no-new-grants precedent as
-- 0054/0055/0058/0059. HAND-APPLIED, idempotent, safe to re-run.

alter table public.applicants add column if not exists candidate_comms_optout boolean not null default false;
