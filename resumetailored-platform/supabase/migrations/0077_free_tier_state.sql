-- Free-tier one-hiring-story state (Taylor Combined Build v5, Section E.6).
--
-- Backs the Free-plan rewrite in lib/employer-free-tier.ts: exactly one job
-- post ever, one active candidate slot, one non-owner employee. Three
-- counters per Free employer:
--   jobs_count            — MONOTONIC count of jobs this employer has ever
--                            created (bumped once per successful createJob
--                            call, never decremented — a free employer can't
--                            delete their way back to zero). The create gate
--                            is simply `jobs_count >= 1` ⇒ blocked.
--   candidates_active     — snapshot BASELINE of this employer's non-rejected
--                            applicant count. For an employer who signs up
--                            after this migration it starts at 0, so their
--                            live ceiling is max(1, 0) = 1 — exactly the new
--                            rule. For an employer GRANDFATHERED in with,
--                            say, 5 active candidates already, it is seeded
--                            to 5 at migration time, so their live ceiling
--                            stays max(1, 5) = 5: everything they already had
--                            keeps working, nothing is clawed back, and they
--                            still can never grow past what they had the
--                            moment this ran.
--   employees_non_owner   — the same snapshot-baseline idea for this
--                            employer's non-owner employees count
--                            (lib/employees-store.ts; the owner's own
--                            clerk_user_id is excluded by the application
--                            layer, same as the live count is).
--
-- `last_candidate_refill_at` is NOT in the original four-column sketch for
-- this table, but Marvin's rule 2 ("30-day refill cooldown" after a candidate
-- slot frees up) has nowhere else to live — there is no other per-employer,
-- app-owned timestamp column this product already has for it, and
-- lib/employer-free-tier.ts needs a real place to read/write it. Added here
-- rather than opening a second migration for one column.
--
-- Same access pattern as every other Assistant/Free-tier table: service-role
-- only, RLS on with no policies — every real read/write is scoped by
-- employer_id in the query layer (lib/employer-free-tier.ts), not by a
-- Postgres policy. Grants are explicit per the Oct 30, 2026 cutoff (new
-- public tables get no automatic Data API grants, not even service_role).
-- HAND-APPLIED, idempotent, safe to re-run.
--
-- The INSERT below is the GRANDFATHER SNAPSHOT itself: it runs exactly once,
-- the moment this migration is applied, computing each existing employer's
-- CURRENT counts straight from job_postings/applicants/employees and seeding
-- this table with them. Anyone who signs up after this migration has already
-- run simply has no row here until their first job/candidate/employee
-- action creates one (lib/employer-free-tier.ts `ensureFreeTierState`),
-- which starts them at zero — never backfilled from this INSERT again
-- (`on conflict (employer_id) do nothing` makes re-running this file safe,
-- not a second snapshot).

create table if not exists public.free_tier_state (
  employer_id text primary key,
  jobs_count integer not null default 0,
  candidates_active integer not null default 0,
  employees_non_owner integer not null default 0,
  last_candidate_refill_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.free_tier_state enable row level security;

revoke all on public.free_tier_state from public, anon, authenticated;
grant select, insert, update on public.free_tier_state to service_role;

-- Grandfather snapshot: every employer who already has at least one job
-- posting gets a row seeded from what they actually have RIGHT NOW. An
-- employer who has never posted a job gets no row — they start clean at
-- zero the normal way, the first time they touch any of this.
insert into public.free_tier_state (employer_id, jobs_count, candidates_active, employees_non_owner)
select
  j.employer_id,
  count(distinct j.id) as jobs_count,
  coalesce((
    select count(*) from public.applicants a
    join public.job_postings jp on jp.id = a.job_id
    where jp.employer_id = j.employer_id and a.status <> 'rejected'
  ), 0) as candidates_active,
  coalesce((
    select count(*) from public.employees e
    where e.employer_id = j.employer_id and (e.clerk_user_id is null or e.clerk_user_id <> j.employer_id)
  ), 0) as employees_non_owner
from public.job_postings j
group by j.employer_id
on conflict (employer_id) do nothing;
