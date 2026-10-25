-- Candidate Q&A (grounded, sample-first) — Prompt 6, Section 1.
--
-- One row per job holding the employer-approved FAQ content for that job
-- PLUS the enable switch for having the assistant answer candidate emails
-- automatically. The two are deliberately separate concerns on the same row:
--
--   - `faq` (jsonb array of {question, answer}): approved via the
--     `add_job_faq` tool (lib/assistant-mutations.ts), one pending action per
--     edit — "Edit of FAQ content = fresh approval" (no in-place silent edit).
--   - `enabled` / `last_enabled_at`: approved via the SEPARATE `enable_candidate_qa`
--     tool's SAMPLE-FIRST pending action (the employer approves the assistant's
--     STYLE and grounding on three sample Q&As before anything can answer a
--     real candidate). Disabling is instant, no approval — same reasoning as
--     assistant_ack_settings: removing a future automated send is strictly
--     safer than adding one.
--
-- `last_enabled_at` is the SAME enable-clock pattern as
-- assistant_ack_settings.last_enabled_at (migration 0065): a question that
-- arrived while Q&A was off must never be answered retroactively just
-- because it's unread when Q&A is turned back on — the inbound handler gates
-- on `enabled = true AND <something after enabling>`, not merely `enabled`.
--
-- Same access pattern as every other assistant_* / job_* table in this
-- feature: service-role only, RLS on with no policies, explicit grants.
-- HAND-APPLIED, idempotent, safe to re-run.

create table if not exists public.job_faqs (
  job_id bigint primary key references public.job_postings(id) on delete cascade,
  employer_id text not null,
  faq jsonb not null default '[]'::jsonb,
  enabled boolean not null default false,
  last_enabled_at timestamptz,
  actor_user_id text not null,
  actor_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_faqs_employer_idx
  on public.job_faqs (employer_id);

alter table public.job_faqs enable row level security;

revoke all on public.job_faqs from public, anon, authenticated;
grant select, insert, update on public.job_faqs to service_role;

-- ── Candidate Q&A audit (per-answer log) ─────────────────────────────────────
-- "every answer logged (audit row with question + grounding sources)" — kept
-- as its own table rather than overloading assistant_audit_log (which logs
-- TOOL CALLS, not candidate-facing sends) because a Q&A answer is a send.
-- Append-only, same trigger-enforced guarantee as assistant_audit_log
-- (migration 0051): UPDATE/DELETE rejected for every role, including
-- service_role, so a buggy process cannot rewrite what was actually sent.
create table if not exists public.job_faq_answers (
  id bigint generated always as identity primary key,
  employer_id text not null,
  job_id bigint not null references public.job_postings(id) on delete cascade,
  applicant_id bigint references public.applicants(id) on delete set null,
  question text not null,
  answer text not null,
  covered boolean not null,
  grounding_sources jsonb not null default '[]'::jsonb,
  sent boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists job_faq_answers_employer_idx
  on public.job_faq_answers (employer_id, created_at desc);
create index if not exists job_faq_answers_job_idx
  on public.job_faq_answers (job_id, created_at desc);

alter table public.job_faq_answers enable row level security;

create or replace function public.job_faq_answers_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'job_faq_answers is append-only: % is not permitted', tg_op;
end;
$$;

drop trigger if exists job_faq_answers_no_update on public.job_faq_answers;
create trigger job_faq_answers_no_update
  before update on public.job_faq_answers
  for each row execute function public.job_faq_answers_block_mutation();

drop trigger if exists job_faq_answers_no_delete on public.job_faq_answers;
create trigger job_faq_answers_no_delete
  before delete on public.job_faq_answers
  for each row execute function public.job_faq_answers_block_mutation();

revoke all on public.job_faq_answers from public, anon, authenticated;
grant select, insert, update on public.job_faq_answers to service_role;
