-- Application Tracker — Kanban + self-filling clip (Combined Build, Section 1
-- and Section 2). Distinct from the older, simpler `applications` table
-- (migration 0004) — that table stays untouched (still backing
-- /candidate/applications, the hand-entry list view); `tracked_applications`
-- is the new Kanban-shaped tracker with stage dwell/nudges and the
-- self-filling clip (paste-URL / share-target / manual add). Both are Free
-- tier. A later pass may consolidate the two surfaces; not attempted here —
-- out of this build's scope, and neither table's data is touched by the
-- other.
--
-- `source_job_id` is bigint, not uuid as an earlier draft of this spec
-- assumed — `job_postings.id` (migration 0012_employer.sql) is
-- `bigint generated always as identity`, so a uuid FK would never match a
-- real row. References `job_postings(id)` with `on delete set null`: a
-- tracked application must survive a job posting being deleted (the
-- candidate's own record of having applied is theirs to keep), it just loses
-- the "ours" link and falls back to being treated as external.
--
-- `salary_min`/`salary_max` are numeric, not every candidate posting has a
-- parseable salary and the honesty rule (Section 2) requires these to stay
-- genuinely null rather than a guessed 0.
--
-- `notes` is jsonb (an array of {id, text, createdAt} so multiple dated notes
-- can accumulate on one card, per the Kanban note-per-card requirement) —
-- not a single text column like the older `applications.notes`.
--
-- `extracted_meta` jsonb holds the raw meta/JSON-LD captured at clip time,
-- kept verbatim for audit — never shown to the candidate directly, just the
-- derived fields above it.
--
-- Same access pattern as every table created after the 2026-10-30 cutoff:
-- service-role only, RLS on with no policies, explicit grants limited to the
-- verbs the server code actually issues. HAND-APPLIED, idempotent, safe to
-- re-run. NOT applied here — left for the operator's own migration run.

create table if not exists public.tracked_applications (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,
  job_title       text not null default '',
  company         text not null default '',
  location        text,
  posting_url     text,
  description     text,
  salary_min      numeric,
  salary_max      numeric,
  source          text not null default 'manual' check (source in ('manual', 'clip_url', 'share_target', 'our_job')),
  source_job_id   bigint references public.job_postings(id) on delete set null,
  stage           text not null default 'Clipped' check (stage in ('Clipped', 'Applied', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn')),
  stage_changed_at timestamptz not null default now(),
  applied_at      timestamptz,
  notes           jsonb not null default '[]'::jsonb,
  extracted_meta  jsonb,
  nudges_off      boolean not null default false,
  last_verified_at timestamptz,
  archived        boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists tracked_applications_user_stage_idx on public.tracked_applications (user_id, stage);
create index if not exists tracked_applications_user_updated_idx on public.tracked_applications (user_id, updated_at desc);

alter table public.tracked_applications enable row level security;

revoke all on public.tracked_applications from public, anon, authenticated;
grant select, insert, update, delete on public.tracked_applications to service_role;
