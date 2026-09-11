-- Employer Dashboard (Phase 3) — company profiles, job postings, applicants,
-- team members/invites, and a match-score cache. The server writes everything
-- with the service-role key (scoped by employer_id/user_id in each query), so
-- RLS is enabled with no public policies — the same pattern as every other
-- table in this app.

-- Employer profiles (onboarding: one row per employer account).
create table if not exists public.employer_profiles (
  user_id text not null primary key,
  company_name text not null,
  company_website text,
  industry text,
  company_size text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Job postings.
create table if not exists public.job_postings (
  id bigint generated always as identity primary key,
  employer_id text not null,
  title text not null,
  department text,
  location text,
  remote_type text,
  employment_type text,
  salary_min int,
  salary_max int,
  salary_currency text default 'USD',
  description text not null,
  requirements jsonb not null default '[]'::jsonb,
  nice_to_haves jsonb not null default '[]'::jsonb,
  deadline date,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_postings_employer_status_idx on public.job_postings (employer_id, status, created_at desc);

-- Applicants (one row per person per job).
create table if not exists public.applicants (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.job_postings(id) on delete cascade,
  name text not null,
  email text not null,
  resume_text text,
  cover_letter text,
  match_score int,
  match_analysis jsonb,
  status text not null default 'new' check (status in ('new', 'reviewed', 'shortlisted', 'interviewed', 'hired', 'rejected')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists applicants_job_status_idx on public.applicants (job_id, status, created_at desc);

-- Team members / invites.
create table if not exists public.team_members (
  id bigint generated always as identity primary key,
  employer_id text not null,
  user_id text,
  email text not null,
  role text not null default 'viewer' check (role in ('owner', 'admin', 'recruiter', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'active')),
  invite_token text unique,
  created_at timestamptz not null default now()
);
create index if not exists team_members_employer_idx on public.team_members (employer_id, status);

-- Match-score cache (avoid re-scoring the same applicant/job pair).
create table if not exists public.match_scores (
  id bigint generated always as identity primary key,
  applicant_id bigint not null references public.applicants(id) on delete cascade,
  job_id bigint not null references public.job_postings(id) on delete cascade,
  score int not null,
  analysis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(applicant_id, job_id)
);

alter table public.employer_profiles enable row level security;
alter table public.job_postings enable row level security;
alter table public.applicants enable row level security;
alter table public.team_members enable row level security;
alter table public.match_scores enable row level security;
