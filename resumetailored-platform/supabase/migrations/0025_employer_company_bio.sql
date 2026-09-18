-- Company profile: a multi-line company bio, surfaced on the employer's public
-- career page alongside the name, logo, and industry.
--
-- HAND-APPLIED: run this against the Supabase project before deploying. It is
-- idempotent (add column if not exists), so it is safe on a fresh or existing
-- DB, and safe to re-run.
--
-- Note: the reader (lib/employer-store.getEmployerProfile) tolerates this column
-- being absent — it falls back to the base columns rather than returning null —
-- so a deploy that lands before this migration does NOT lock employers out of
-- the portal. Applying the migration simply lights up the bio field.
alter table public.employer_profiles
  add column if not exists company_bio text;
