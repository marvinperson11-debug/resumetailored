-- 0043 — usage_counters: monotonic per-scope, per-period counters.
--
-- Quotas that used to be derived from live rows (e.g. "video interviews this
-- month" = COUNT(interviews)) could be reset by deleting the rows. A counter
-- only ever goes up, so create -> delete -> create can't bypass a cap. Mirrors
-- the Legacy app's employer_profiles.jobs_posted_lifetime pattern.
--
--   scope_id : Clerk user id (employer workspace id, or a candidate user id)
--   kind     : e.g. 'video_interview', 'tailor_variants'
--   period   : 'YYYY-MM' (UTC calendar month) or 'total'
--
-- HAND-APPLIED, idempotent, safe to re-run. The app falls back to the live-row
-- count (never to "unlimited") while this is unapplied, so deploy order doesn't
-- matter for the video quota; the Pro variant monthly cap fails open until applied.

create table if not exists public.usage_counters (
  scope_id   text        not null,
  kind       text        not null,
  period     text        not null,
  count      integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope_id, kind, period)
);

alter table public.usage_counters enable row level security;

-- Atomic increment; returns the new value.
create or replace function public.bump_usage_counter(p_scope text, p_kind text, p_period text, p_by integer default 1)
returns integer
language plpgsql
as $$
declare
  new_count integer;
begin
  insert into public.usage_counters (scope_id, kind, period, count)
  values (p_scope, p_kind, p_period, greatest(p_by, 0))
  on conflict (scope_id, kind, period)
  do update set count = public.usage_counters.count + greatest(p_by, 0), updated_at = now()
  returning count into new_count;
  return new_count;
end;
$$;
