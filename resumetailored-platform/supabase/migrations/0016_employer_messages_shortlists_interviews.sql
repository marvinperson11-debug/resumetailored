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

-- ── Column fixes ─────────────────────────────────────────────────────────────
-- The code selects/writes these columns; some live tables predate them. Both
-- guards are no-ops on a fresh database (the columns already exist above / in
-- 0012) and heal an existing database, so this migration is safe to re-run.
alter table public.job_postings add column if not exists public_listed boolean default false;
alter table public.shortlists add column if not exists updated_at timestamp with time zone default now();

-- ── Row level security ───────────────────────────────────────────────────────
-- The server writes everything with the service-role key (which bypasses RLS),
-- scoping each query by employer_id itself. These policies are defense-in-depth
-- for any direct (anon/authenticated) access. `employer_id` is the Clerk user
-- id (TEXT, e.g. user_3Iy2u…), NOT a uuid, so auth.uid() is cast with ::text.
-- Postgres has no CREATE POLICY IF NOT EXISTS, so each policy is dropped first,
-- which keeps this migration idempotent.
alter table public.job_postings enable row level security;
alter table public.shortlists enable row level security;
alter table public.shortlist_members enable row level security;
alter table public.messages enable row level security;
alter table public.interviews enable row level security;

drop policy if exists job_postings_owner on public.job_postings;
create policy job_postings_owner on public.job_postings
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

drop policy if exists shortlists_owner on public.shortlists;
create policy shortlists_owner on public.shortlists
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

-- shortlist_members has no employer_id — authorize via its parent shortlist.
drop policy if exists shortlist_members_owner on public.shortlist_members;
create policy shortlist_members_owner on public.shortlist_members
  for all
  using (
    exists (
      select 1 from public.shortlists s
      where s.id = shortlist_members.shortlist_id and s.employer_id = auth.uid()::text
    )
  )
  with check (
    exists (
      select 1 from public.shortlists s
      where s.id = shortlist_members.shortlist_id and s.employer_id = auth.uid()::text
    )
  );

drop policy if exists messages_owner on public.messages;
create policy messages_owner on public.messages
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

drop policy if exists interviews_owner on public.interviews;
create policy interviews_owner on public.interviews
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

-- ── Career Site Builder (feature #11) ────────────────────────────────────────
-- One public careers page per employer, served at /careers/:slug. Same
-- service-role + employer_id-scoped pattern as the tables above.
create table if not exists public.career_sites (
  id bigint generated always as identity primary key,
  employer_id text not null,
  company_name text,
  slug text unique,
  logo_url text,
  banner_url text,
  brand_color text default '#F59E0B',
  about_text text,
  mission_text text,
  values_text text,
  show_about boolean default true,
  show_benefits boolean default true,
  show_team boolean default false,
  show_testimonials boolean default false,
  show_contact boolean default true,
  benefits jsonb default '[]'::jsonb,
  testimonials jsonb default '[]'::jsonb,
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists career_sites_employer_idx on public.career_sites (employer_id);
create index if not exists career_sites_slug_idx on public.career_sites (slug);

alter table public.career_sites enable row level security;

drop policy if exists career_sites_owner on public.career_sites;
create policy career_sites_owner on public.career_sites
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

-- Career site logo/banner uploads (Phase 1B). A public bucket — these are
-- public career-page assets. The server uploads with the service-role key
-- (bypasses RLS); these storage policies are defense-in-depth for direct
-- client access and confine each employer to their own {clerkUserId}/ folder.
-- All idempotent (on conflict do nothing / drop policy if exists).
insert into storage.buckets (id, name, public)
values ('career-site-assets', 'career-site-assets', true)
on conflict (id) do nothing;

drop policy if exists career_assets_insert on storage.objects;
create policy career_assets_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'career-site-assets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists career_assets_update on storage.objects;
create policy career_assets_update on storage.objects
  for update to authenticated
  using (bucket_id = 'career-site-assets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'career-site-assets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists career_assets_delete on storage.objects;
create policy career_assets_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'career-site-assets' and (storage.foldername(name))[1] = auth.uid()::text);
