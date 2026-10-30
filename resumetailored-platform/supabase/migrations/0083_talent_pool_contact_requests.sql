-- Talent Pool — employer→candidate contact requests. One row per request;
-- `candidate_id` is denormalized onto the row (also present via
-- `pool_profile_id`'s parent) specifically so every RLS-style scoping query
-- the server issues (list a candidate's incoming requests, list an
-- employer's sent requests) can filter directly on this table by a single
-- Clerk id column, the same shape `tracked_applications.user_id` and
-- `talent_pool_profiles.candidate_id` already use — no join required for the
-- common-path reads.
--
-- `status` is a plain text + check-constraint enum (never a Postgres enum
-- type), matching `tracked_applications.stage`'s convention. The state
-- machine (lib/talent-pool-core.ts `validateContactStatusMove`): pending →
-- accepted | declined | withdrawn, and nothing else — no transition out of
-- a terminal state. `responded_at` is stamped the first time a row leaves
-- "pending" and never touched again.
--
-- Caps/abuse controls (Q1/Q7, enforced in lib/talent-pool-store.ts, not in
-- SQL — same division of labor as every other allowance check in this repo,
-- e.g. checkSeatAllowance in lib/employer-plan.ts): max 10 PENDING requests
-- per employer at once, and an employer may not re-send to a candidate they
-- have already been declined by. The `(employer_id, status)` and
-- `(employer_id, candidate_id)` indexes below exist to make both of those
-- checks a cheap index scan rather than a table scan.
--
-- No message content beyond the employer's own free-text `message` is ever
-- stored for the candidate's reply — this is request-only (Q3): accept/
-- decline, no threaded messaging. Declining is final for that
-- employer/candidate pair; nothing here resurrects a declined row.
--
-- Same access pattern as every table created after the 2026-10-30 cutoff
-- (see 0078_tracked_applications.sql's header): service-role only, RLS on
-- with no policies, explicit grants limited to the verbs the server code
-- actually issues — no delete grant, since a request is only ever updated
-- (its status moves) and never removed, the same append/update-only
-- treatment `application_events` gets as an audit trail. HAND-APPLIED,
-- idempotent, safe to re-run. NOT applied here — left for the operator's own
-- migration run.

create table if not exists public.talent_pool_contact_requests (
  id              uuid primary key default gen_random_uuid(),
  pool_profile_id uuid not null references public.talent_pool_profiles(id) on delete cascade,
  employer_id     text not null,
  candidate_id    text not null,
  message         text not null default '',
  status          text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at      timestamptz not null default now(),
  responded_at    timestamptz
);

create index if not exists talent_pool_contact_requests_candidate_idx on public.talent_pool_contact_requests (candidate_id, status);
create index if not exists talent_pool_contact_requests_employer_idx on public.talent_pool_contact_requests (employer_id, status);
create index if not exists talent_pool_contact_requests_employer_candidate_idx on public.talent_pool_contact_requests (employer_id, candidate_id);
create index if not exists talent_pool_contact_requests_profile_idx on public.talent_pool_contact_requests (pool_profile_id);

alter table public.talent_pool_contact_requests enable row level security;

revoke all on public.talent_pool_contact_requests from public, anon, authenticated;
grant select, insert, update on public.talent_pool_contact_requests to service_role;
