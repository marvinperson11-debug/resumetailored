-- Employer Portal AI Assistant — per-employer learning (Taylor Combined Build
-- v5, Section D).
--
-- Deterministic, observation-only signals Taylor notices about ONE
-- employer's own habits from what they've actually APPROVED (never from a
-- mere draft) — candidate-message style, how they tend to address
-- candidates, and their interview-scheduling patterns
-- (lib/assistant-employer-learning.ts). Every row is a tally
-- (`counts_json`) plus the current dominant value (`signal_value`); nothing
-- here is ever sent, applied, or acted on by itself — it only ever backs a
-- SUGGESTION the employer can accept, correct, or delete from the
-- "What Taylor has learned about you" view. `corrected` pins a value the
-- employer explicitly set so a later batch of new observations can never
-- silently overwrite a correction.
--
-- One row per (employer_id, category, signal_key) — upserted in place as new
-- observations arrive, never append-only (unlike assistant_audit_log, which
-- this table is NOT a substitute for: nothing here records WHAT the employer
-- did, only the pattern noticed in aggregate).
--
-- Same access pattern as every other Assistant table (assistant_audit_log,
-- assistant_pending_actions, employer_reminders, …): service-role only, RLS
-- on with no policies — every real read/write is scoped by employer_id in
-- the query layer (lib/assistant-employer-learning.ts), not by a Postgres
-- policy. Grants are explicit per the Oct 30, 2026 cutoff (new public tables
-- get no automatic Data API grants, not even service_role) — delete is
-- granted too, since the employer-visible view supports deleting a learned
-- item outright. HAND-APPLIED, idempotent, safe to re-run.

create table if not exists public.assistant_employer_learning (
  id uuid primary key default gen_random_uuid(),
  employer_id text not null,
  category text not null check (category in ('message_style', 'interview_pattern', 'name_preference')),
  signal_key text not null,
  signal_value text not null,
  counts_json jsonb not null default '{}'::jsonb,
  sample_count integer not null default 0,
  corrected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employer_id, category, signal_key)
);

create index if not exists assistant_employer_learning_employer_idx
  on public.assistant_employer_learning (employer_id);

alter table public.assistant_employer_learning enable row level security;

revoke all on public.assistant_employer_learning from public, anon, authenticated;
grant select, insert, update, delete on public.assistant_employer_learning to service_role;
