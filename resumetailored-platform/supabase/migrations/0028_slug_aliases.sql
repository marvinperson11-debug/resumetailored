-- Old-slug → current-tenant aliases. Renaming a career site (career_sites.slug)
-- or a candidate personal site (personal_sites.slug) used to kill the old URL
-- (404). Each rename now leaves a forwarding row here, so the old subdomain and
-- the old /careers/:slug or /site/:slug path 301-redirect to the current slug —
-- preserving SEO and any links already shared.
--
-- A slug lives in ONE global namespace across both tenant kinds (see
-- tenant-resolve.ts). An alias reserves the old slug in that namespace too, so a
-- renamed slug can never be re-claimed by anyone else while the redirect lives.
-- Read via the service-role key only, so RLS is enabled with no public policies
-- (the same defense-in-depth pattern as every other table here) — with RLS on
-- and no policy, the anon/authenticated API cannot read it at all.
--
-- HAND-APPLIED: run this against the Supabase project before deploying. It is
-- idempotent (create table if not exists / add column if not exists / create
-- index if not exists), so it is safe on a fresh or existing DB and safe to
-- re-run.
create table if not exists public.slug_aliases (
  id          bigint      generated always as identity primary key,
  slug        text        not null unique,
  target_type text        not null check (target_type in ('career', 'site')),
  target_id   bigint      not null,
  created_at  timestamptz not null default now()
);
-- Resolution direction is alias.slug → (target_type, target_id) → the current
-- row's slug, so index the target for the reverse lookups and cleanups.
create index if not exists slug_aliases_target_idx on public.slug_aliases (target_type, target_id);

alter table public.slug_aliases enable row level security;

-- career_sites already has a bigint identity id (0016); personal_sites keyed on
-- its (mutable) slug does not. An alias must point at a STABLE id that survives a
-- slug rename, so give personal_sites the same kind of id. `generated always as
-- identity` backfills existing rows; the unique index makes the by-id lookup
-- reliable + fast. Idempotent.
alter table public.personal_sites add column if not exists id bigint generated always as identity;
create unique index if not exists personal_sites_id_idx on public.personal_sites (id);
