-- Video-interview summarization against stored kits — Prompt 6, Section 2.
--
-- `summarize_interview` (lib/assistant-mutations.ts) scores a PASTED interview
-- transcript against the job's own saved interview kit (job_interview_kits,
-- migration 0066) — one capped LLM call producing a per-criterion assessment
-- with a QUOTED evidence line from the transcript for every judgment
-- (anti-fabrication: lib/interview-summaries.ts structurally verifies each
-- quote is an actual substring of the transcript before trusting it; a
-- criterion the model can't ground in a real quote is forced to "insufficient
-- evidence" in code, not just by prompt instruction). The employer still
-- scores/decides — this is advisory, stated on the card and in the stored row.
--
-- This is NOT the existing Daily.co webhook `interviews.ai_summary` column
-- (migration 0019): that one is auto-generated (no employer approval),
-- ungrounded against any scorecard, and tied to a recorded/transcribed Daily
-- session. `interview_summaries` is a separate, approval-gated surface fed by
-- a transcript the employer pastes in (V1 boundary — no new recording/
-- transcription infrastructure here). See the Prompt 6 report for why the two
-- are deliberately left to coexist rather than merged.
--
-- `interview_id` is the primary key — one summary per interview; a second
-- summarize_interview approval REPLACES it (upsert on conflict), same
-- "no versioning" precedent as job_interview_kits (migration 0066).
--
-- Same access pattern as every other assistant_*/job_* table in this feature:
-- service-role only, RLS on with no policies, explicit grants. HAND-APPLIED,
-- idempotent, safe to re-run.

create table if not exists public.interview_summaries (
  interview_id bigint primary key references public.interviews(id) on delete cascade,
  employer_id text not null,
  summary jsonb not null default '{}'::jsonb,
  source text not null default 'pasted_transcript' check (source in ('pasted_transcript')),
  created_at timestamptz not null default now()
);

create index if not exists interview_summaries_employer_idx
  on public.interview_summaries (employer_id);

alter table public.interview_summaries enable row level security;

revoke all on public.interview_summaries from public, anon, authenticated;
grant select, insert, update on public.interview_summaries to service_role;
