-- Shareable Link (FREE feature) — a single, simple public profile per user at
-- /u/<username>. Completely separate from the Pro Website Creator's
-- `personal_sites` (/site/<slug>). The server reads/writes with the
-- service-role key; the public /u/<username> route reads by username.
create table if not exists public.shareable_profiles (
  user_id      text        primary key,
  username     text        not null unique,
  name         text        not null default '',
  headline     text        not null default '',
  photo_url    text,
  bio          text        not null default '',
  contact_info jsonb       not null default '{}'::jsonb,
  theme        text        not null default 'aurora',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Case-insensitive uniqueness for usernames (Alex and alex are the same handle).
create unique index if not exists shareable_profiles_username_lower_idx
  on public.shareable_profiles (lower(username));
alter table public.shareable_profiles enable row level security;
