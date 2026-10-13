-- Employer resume viewer: PDF link + private annotations.
--
-- NEW TABLES ONLY — nothing existing is altered.
--
--  applicant_resume_files   which uploaded PDF in the PRIVATE `applicant-resumes` bucket (0016) belongs to
--                           which applicant. Until now the add-applicant form archived the file but never
--                           recorded the link, so there was nothing to open. One current file per applicant.
--  resume_annotations       an employer team's highlights and notes ON a resume. They are the employer's own
--                           working notes: stored beside the file, never written into it (the PDF is not
--                           modified), and never shown to the candidate.
--
-- Access is server-side only, like every other employer table (0012, 0016): the app talks to Postgres with the
-- service-role key AFTER checking the caller owns the applicant, so RLS is ON with NO policy for anon or
-- authenticated — a candidate (or anyone) holding the public anon key cannot read a single row. The revoke below
-- makes that explicit instead of relying on "no policy" alone.

create table if not exists public.applicant_resume_files (
  id            uuid        primary key default gen_random_uuid(),
  employer_id   text        not null,
  applicant_id  bigint      not null references public.applicants(id) on delete cascade,
  -- Path inside the private `applicant-resumes` bucket: {employer_id}/resume/{ts}-{name}.pdf. Never a public URL.
  storage_path  text        not null,
  filename      text        not null default 'resume.pdf',
  size_bytes    bigint      not null default 0,
  created_at    timestamptz not null default now(),
  unique (applicant_id),
  -- lets resume_annotations prove, in the database, that an annotation and its file share an employer
  unique (id, employer_id)
);
create index if not exists applicant_resume_files_employer_idx on public.applicant_resume_files (employer_id, applicant_id);

create table if not exists public.resume_annotations (
  id                  uuid             primary key default gen_random_uuid(),
  employer_id         text             not null,
  candidate_resume_id uuid             not null,
  -- 1-based page number
  page                int              not null check (page >= 1),
  -- Page-normalised 0..1 box (origin top-left), so an annotation survives zoom, device and renderer changes.
  -- A note is a pin: w = h = 0.
  x                   double precision not null check (x >= 0 and x <= 1),
  y                   double precision not null check (y >= 0 and y <= 1),
  w                   double precision not null default 0 check (w >= 0 and w <= 1),
  h                   double precision not null default 0 check (h >= 0 and h <= 1),
  kind                text             not null check (kind in ('highlight', 'note')),
  text                text             not null default '' check (char_length(text) <= 2000),
  color               text             not null default 'yellow' check (color in ('yellow', 'green', 'blue', 'pink')),
  created_by          text             not null,
  created_at          timestamptz      not null default now(),
  updated_at          timestamptz      not null default now(),
  foreign key (candidate_resume_id, employer_id)
    references public.applicant_resume_files (id, employer_id) on delete cascade
);
create index if not exists resume_annotations_file_idx on public.resume_annotations (employer_id, candidate_resume_id, page, created_at);

alter table public.applicant_resume_files enable row level security;
alter table public.resume_annotations enable row level security;
revoke all on public.applicant_resume_files from anon, authenticated;
revoke all on public.resume_annotations from anon, authenticated;
