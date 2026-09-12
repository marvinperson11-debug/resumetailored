-- Candidate profile + account preferences. One row per Clerk user. The name,
-- email, and avatar live in Clerk (the source of truth); this table holds the
-- extra profile fields and the Settings toggles. Written server-side with the
-- service-role key, scoped by user_id — RLS on, no public policies (same
-- pattern as every other table here).
create table if not exists public.user_profiles (
  user_id text not null primary key,
  phone text,
  location text,
  linkedin_url text,
  website_url text,
  bio text,
  -- Settings toggles:
  profile_public boolean not null default false,
  email_product boolean not null default true,
  email_tips boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;
