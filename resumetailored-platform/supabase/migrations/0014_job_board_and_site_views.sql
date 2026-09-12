-- Feature E (public job board) + Feature A (site view analytics).

-- Per-posting visibility on the public /jobs board (default off).
alter table public.job_postings add column if not exists public_listed boolean not null default false;
create index if not exists job_postings_public_idx on public.job_postings (public_listed, status, created_at desc);

-- Personal-website view counter (incremented on each public /site/<slug> visit).
alter table public.personal_sites add column if not exists views integer not null default 0;
