-- Employer Portal Phase 1A — Messages, Shortlists, and Interview Scheduler.
-- Follows the same pattern as 0012_employer.sql: the server writes everything
-- with the service-role key (every query scoped by employer_id, or by the
-- employer's own applicant/job ids), so RLS is enabled with no public policies.

-- ── Messages ────────────────────────────────────────────────────────────────
-- In-app conversation between an employer and a candidate (applicant). One row
-- per message; `sender` says which side wrote it. `read` tracks whether the
-- employer has seen an inbound (candidate) message.
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  employer_id text not null,
  applicant_id bigint not null references public.applicants(id) on delete cascade,
  sender text not null check (sender in ('employer', 'candidate')),
  content text not null,
  attachments jsonb not null default '[]'::jsonb,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_employer_applicant_idx
  on public.messages (employer_id, applicant_id, created_at desc);

-- ── Shortlists ──────────────────────────────────────────────────────────────
-- Named collections of candidates ("Frontend — final round"), independent of
-- the single per-applicant status. A candidate can sit in several shortlists.
create table if not exists public.shortlists (
  id bigint generated always as identity primary key,
  employer_id text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shortlists_employer_idx
  on public.shortlists (employer_id, created_at desc);

create table if not exists public.shortlist_members (
  id bigint generated always as identity primary key,
  shortlist_id bigint not null references public.shortlists(id) on delete cascade,
  applicant_id bigint not null references public.applicants(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique (shortlist_id, applicant_id)
);
create index if not exists shortlist_members_shortlist_idx
  on public.shortlist_members (shortlist_id, added_at desc);

-- ── Interviews ──────────────────────────────────────────────────────────────
-- A scheduled interview with a candidate. `mode` is how it happens; `location`
-- doubles as the meeting link (video) or the address (onsite).
create table if not exists public.interviews (
  id bigint generated always as identity primary key,
  employer_id text not null,
  applicant_id bigint not null references public.applicants(id) on delete cascade,
  job_id bigint references public.job_postings(id) on delete set null,
  title text not null,
  scheduled_at timestamptz not null,
  duration_min int not null default 30,
  mode text not null default 'video' check (mode in ('video', 'phone', 'onsite')),
  location text,
  interviewer text,
  notes text,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists interviews_employer_time_idx
  on public.interviews (employer_id, scheduled_at);
create index if not exists interviews_applicant_idx
  on public.interviews (applicant_id, scheduled_at desc);

alter table public.messages enable row level security;
alter table public.shortlists enable row level security;
alter table public.shortlist_members enable row level security;
alter table public.interviews enable row level security;
