-- Role playbooks, interview kits, and screening questions (Prompt 5).
--
-- Interview kits (lib/interview-kits.ts): a capped-LLM-generated set of
-- interview questions + scorecard criteria, grounded ONLY in a real job's
-- own title/description/requirements (create_interview_kit,
-- lib/assistant-mutations.ts) — or seeded from a static role playbook with
-- no LLM call at all (start_job_from_playbook, lib/playbooks.ts). One kit
-- per job; a second generation/playbook REPLACES it (job_id is the primary
-- key, upserted on conflict) — there is no versioning requirement here.
--
-- screening_questions is a new column on the EXISTING job_postings table: a
-- plain string array, same shape as the existing requirements/
-- nice_to_haves columns (which are themselves jsonb, see 0012). Checked
-- first: no screening-question storage existed anywhere on job_postings
-- before this. Populated today only by start_job_from_playbook; a freehand
-- draft_job_post leaves it empty, same as requirements/nice_to_haves do for
-- one. Pure ALTER on an existing, already-granted table — same
-- no-new-grants precedent as 0044/0065 (job_postings predates the 2026-10-30
-- grant cutoff and has never needed an explicit grant line).
--
-- job_interview_kits is a NEW table: same access pattern as every other
-- assistant table (service-role only, RLS on with no policies, explicit
-- grants — see 0052/0053 for why these are explicit rather than relied-upon
-- after the cutoff). HAND-APPLIED, idempotent, safe to re-run.

alter table public.job_postings add column if not exists screening_questions jsonb not null default '[]'::jsonb;

create table if not exists public.job_interview_kits (
  job_id bigint primary key references public.job_postings(id) on delete cascade,
  employer_id text not null,
  questions jsonb not null default '[]'::jsonb,
  scorecard jsonb not null default '[]'::jsonb,
  source text not null default 'llm' check (source in ('llm', 'playbook')),
  created_at timestamptz not null default now()
);

create index if not exists job_interview_kits_employer_idx
  on public.job_interview_kits (employer_id);

alter table public.job_interview_kits enable row level security;

revoke all on public.job_interview_kits from public, anon, authenticated;
grant select, insert, update on public.job_interview_kits to service_role;
