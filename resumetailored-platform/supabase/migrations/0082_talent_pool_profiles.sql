-- Talent Pool ("Get Found by employers") — candidate opt-in profile.
-- One row per candidate who has ever opted in; `candidate_id` (the Clerk
-- user id, same `text not null` convention as `tracked_applications.user_id`
-- — never a uuid, never a foreign key into a Supabase auth table) is unique,
-- so opting in twice updates the same row rather than creating a second one.
--
-- `is_discoverable` is the master switch: false by default (opt-in, not
-- opt-out) and flipped straight to false the instant the candidate opts out
-- (see POST /api/talent-pool/profile) — never a soft "pending removal" state,
-- per the spec's immediate-effect requirement. `opted_in_at`/`opted_out_at`
-- are the audit trail (Q5): this is a SOFT delete model — a candidate who
-- opts out keeps their row (so opting back in restores their filled-in
-- fields instead of starting over), just with `is_discoverable = false`.
-- There is no hard-delete path here; one follows the account-deletion flow
-- if that flow exists (confirm separately — out of scope for this file).
--
-- `skills` / `desired_roles` are jsonb arrays of strings, matching the
-- tracker's own choice of jsonb-over-text[] for array-shaped fields
-- (`tracked_applications.notes`) — never text[] anywhere in this schema.
-- `years_experience` is numeric, not int, for the same reason
-- `tracked_applications.salary_min/max` are numeric: a candidate's input
-- here is never forced into a shape it doesn't have (e.g. "7.5 years").
--
-- `visibility` is a jsonb map keyed by field name (`{"headline": true,
-- "location": false, ...}`) — the candidate's own per-field show/hide
-- choice. Contact details are NEVER stored here: there is no email/phone
-- column on this table at all. A contact's actual delivery address is
-- resolved at accept-time from the candidate's account (Clerk), per the
-- request-only flow in talent_pool_contact_requests — this table only ever
-- holds what an employer may see on a card/detail view, never how to reach
-- the person directly.
--
-- Same access pattern as every table created after the 2026-10-30 cutoff
-- (see 0078_tracked_applications.sql's header): service-role only, RLS on
-- with no policies, explicit grants limited to the verbs the server code
-- actually issues (the server scopes every query by candidate_id/employer_id
-- itself — see lib/talent-pool-store.ts). HAND-APPLIED, idempotent, safe to
-- re-run. NOT applied here — left for the operator's own migration run.

create table if not exists public.talent_pool_profiles (
  id                  uuid primary key default gen_random_uuid(),
  candidate_id        text not null unique,
  is_discoverable     boolean not null default false,
  headline            text,
  skills              jsonb not null default '[]'::jsonb,
  location            text,
  desired_roles       jsonb not null default '[]'::jsonb,
  years_experience    numeric,
  work_authorization  text,
  bio                 text,
  visibility          jsonb not null default '{}'::jsonb,
  opted_in_at         timestamptz,
  opted_out_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Employer browse/search: discoverable rows only, then filtered by skills,
-- location, desired role, years of experience. GIN indexes on the two jsonb
-- array columns so a "has this skill" / "wants this role" containment query
-- (`skills @> '["python"]'`) doesn't scan the whole table.
create index if not exists talent_pool_profiles_discoverable_idx on public.talent_pool_profiles (is_discoverable);
create index if not exists talent_pool_profiles_location_idx on public.talent_pool_profiles (location) where is_discoverable;
create index if not exists talent_pool_profiles_years_idx on public.talent_pool_profiles (years_experience) where is_discoverable;
create index if not exists talent_pool_profiles_skills_gin_idx on public.talent_pool_profiles using gin (skills);
create index if not exists talent_pool_profiles_desired_roles_gin_idx on public.talent_pool_profiles using gin (desired_roles);

alter table public.talent_pool_profiles enable row level security;

revoke all on public.talent_pool_profiles from public, anon, authenticated;
grant select, insert, update, delete on public.talent_pool_profiles to service_role;
