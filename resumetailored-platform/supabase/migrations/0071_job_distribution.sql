-- Job Distribution (Kimi prompt v3, Oct 25 2026 — Google Jobs markup for every
-- public listing, automatic; Indeed XML feed + LinkedIn share link/partner
-- instructions, Scale+ and behind per-job employer approval).
--
-- Three additions:
--
-- 1. job_postings gets three nullable timestamptz columns. There was no
--    "when did this go live" column on job_postings at all (status flips to
--    'active' in place, with no stamp) — so `published_at` is added here too,
--    not just `valid_through`, because the spec's "default 30 days from
--    publish" has nothing to compute FROM without it. Both
--    lib/assistant-mutations.ts `executePublishJob` and the hand-driven
--    PATCH /api/employer/jobs/[id] route stamp `published_at` the first time
--    a job goes active+public. `expiry_nudged_at` is the idempotency marker
--    for the once-a-week nudge (lib/job-expiry-nudge.ts) — distinct from
--    `published_at`/`valid_through` so re-nudging logic never confuses "when
--    it went live" with "when we last pestered the employer about it".
--
-- 2. employer_profiles gets a nullable, unique `job_feed_token` — the
--    unguessable path segment for that employer's own Indeed XML feed
--    (GET /api/jobs/feed/[token]), generated on first use
--    (lib/job-distribution-store.ts `ensureEmployerFeedToken`), same
--    opaque-token-on-an-existing-row shape as `docusign_envelopes.sign_token`.
--
-- 3. applicants gets a nullable `attribution` jsonb (utm_source/medium/
--    campaign captured from the public job page's query string at apply
--    time — see app/jobs/[jobId]/page.tsx -> apply-form.tsx ->
--    app/api/public/jobs/[jobId]/apply/route.ts).
--
-- 4. A brand-new job_distribution table: one row per job that has ever had
--    distribution approved, keyed by job_id (a job is distributed or it
--    isn't — there's nothing to version). `channels` carries the dormant
--    LinkedIn seam (`{ linkedin: { enabled, mode } }`, mode defaults 'share'
--    and 'partner_post' is never written by any code path yet — see
--    lib/job-distribution.ts) so a future partner-API integration slots into
--    the same column with no migration.
--
-- Same access pattern as every table created after the 2026-10-30 cutoff:
-- service-role only, RLS on with no policies, explicit grants limited to the
-- verbs the server code actually issues. HAND-APPLIED, idempotent, safe to
-- re-run.

alter table public.job_postings add column if not exists published_at timestamptz;
alter table public.job_postings add column if not exists valid_through timestamptz;
alter table public.job_postings add column if not exists expiry_nudged_at timestamptz;

alter table public.employer_profiles add column if not exists job_feed_token text;
create unique index if not exists employer_profiles_job_feed_token_idx
  on public.employer_profiles (job_feed_token)
  where job_feed_token is not null;

alter table public.applicants add column if not exists attribution jsonb;

create table if not exists public.job_distribution (
  job_id bigint primary key references public.job_postings(id) on delete cascade,
  employer_id text not null,
  channels jsonb not null default '{}'::jsonb,
  status text not null default 'none',
  actor_user_id text,
  actor_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_distribution_employer_idx on public.job_distribution (employer_id);

alter table public.job_distribution enable row level security;

revoke all on public.job_distribution from public, anon, authenticated;
grant select, insert, update on public.job_distribution to service_role;
