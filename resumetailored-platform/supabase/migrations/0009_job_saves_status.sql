-- Job Finder tracker: extend the existing job_saves table (0003) with a status
-- pipeline + notes so "My Jobs" becomes a real tracker. Non-breaking: existing
-- saved rows keep working and default to status 'saved'. (We extend job_saves
-- rather than create a separate saved_jobs table so existing saves aren't lost.)
alter table public.job_saves add column if not exists status     text not null default 'saved';
alter table public.job_saves add column if not exists notes      text;
alter table public.job_saves add column if not exists updated_at  timestamptz not null default now();

-- Constrain status to the pipeline values (guarded so re-running is safe).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'job_saves_status_check'
  ) then
    alter table public.job_saves
      add constraint job_saves_status_check
      check (status in ('saved', 'applied', 'interview', 'offer', 'rejected'));
  end if;
end $$;

create index if not exists job_saves_user_status_idx on public.job_saves (user_id, status, created_at desc);
