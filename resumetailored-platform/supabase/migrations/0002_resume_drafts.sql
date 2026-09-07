-- Resume drafts / version history (FIX 7 #6/#7, FIX 8).
-- One row per saved resume, keyed by (user_id, id) so the client can autosave
-- into the same row repeatedly (upsert) instead of piling up new rows every 30s.
-- user_id is the Clerk user id. RLS is enabled with no public policy: the server
-- writes with the service-role key (which bypasses RLS), and rows are always
-- scoped by the Clerk user_id the server passes — never by a Supabase session.

create table if not exists public.resume_drafts (
  id          text        not null,
  user_id     text        not null,
  title       text        not null default 'Untitled resume',
  content     jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists resume_drafts_user_updated_idx
  on public.resume_drafts (user_id, updated_at desc);

alter table public.resume_drafts enable row level security;
