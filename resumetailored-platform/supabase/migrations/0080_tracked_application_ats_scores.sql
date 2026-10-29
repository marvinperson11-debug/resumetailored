-- Application Tracker — ATS link (Combined Build, Section 4). Score-only
-- link: the ATS checker (lib/ats-scan.ts) is the source of truth, this table
-- just stores a reference to each run against one tracked application, so a
-- card can show score history over time as the candidate's resume changes.
-- Never reinterpreted — `score`/`verdict` are stored exactly as
-- lib/ats-scan.ts returned them.

create table if not exists public.tracked_application_ats_scores (
  id                      uuid primary key default gen_random_uuid(),
  tracked_application_id  uuid not null references public.tracked_applications(id) on delete cascade,
  user_id                 text not null,
  score                   int not null,
  verdict                 text not null default '',
  resume_id               text,
  resume_label            text,
  run_at                  timestamptz not null default now()
);

create index if not exists tracked_app_ats_scores_app_idx on public.tracked_application_ats_scores (tracked_application_id, run_at desc);

alter table public.tracked_application_ats_scores enable row level security;

revoke all on public.tracked_application_ats_scores from public, anon, authenticated;
grant select, insert on public.tracked_application_ats_scores to service_role;
