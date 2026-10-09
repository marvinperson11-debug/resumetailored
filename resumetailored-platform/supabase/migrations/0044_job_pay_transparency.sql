-- Pay-transparency data capture for job postings.
--   salary_min / salary_max (0012) already hold the wage or good-faith wage range;
--   this adds the pay period the figures are quoted in and a general description of
--   benefits (health insurance, retirement, paid leave, other non-wage compensation).
-- Both are enforced by the app when a posting is PUBLISHED (status = 'active');
-- drafts may leave them empty, and existing rows are untouched (period defaults to
-- 'year', benefits stays NULL). Safe to re-run.
alter table public.job_postings add column if not exists salary_period text not null default 'year';
alter table public.job_postings add column if not exists benefits_description text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'job_postings_salary_period_check') then
    alter table public.job_postings
      add constraint job_postings_salary_period_check check (salary_period in ('hour', 'week', 'month', 'year'));
  end if;
end $$;
