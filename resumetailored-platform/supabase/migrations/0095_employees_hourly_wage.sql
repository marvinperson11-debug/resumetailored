-- Books V1 (4/4) — the one column the hiring tie-in (payroll/time cost
-- flowing into Books, Corporate tier) needs on an existing table. No wage
-- or pay-rate field existed anywhere in the schema before this (see
-- `employees`/`time_entries`) — Books is the first feature to need it, so
-- it lands here rather than on a Timesheets/Employees migration. Optional
-- (null = wage unknown, e.g. a contractor paid outside payroll): the cost
-- rollup in lib/books-store.ts simply skips an employee with no wage set
-- rather than guessing one.
--
-- HAND-APPLIED, idempotent, safe to re-run against the Supabase project
-- before deploying.

alter table public.employees add column if not exists hourly_wage_cents integer;
