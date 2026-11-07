-- Books V1 (1/4) — income & expense entries.
--
-- One row per manual entry, CSV-imported row, or Plaid-matched transaction
-- turned into a real bookkeeping record. `category` is free text (the
-- default category list lives in lib/books-hub.ts, not a DB-enforced enum,
-- so adding a category is a data edit, not a migration). `job_id` is an
-- optional link to an employer's own job posting (bigint, matches
-- `jobs.id`) for the cost-per-hire rollup — no FK, since a job can be
-- deleted independently and an entry tagged to it should keep its own
-- history rather than cascade-delete.
--
-- Same access pattern as every table created after the 2026-10-30 cutoff:
-- service-role only, RLS on with no policies, explicit grants. HAND-APPLIED,
-- idempotent, safe to re-run against the Supabase project before deploying.

create table if not exists public.books_entries (
  id                 uuid primary key default gen_random_uuid(),
  employer_id        text not null,
  type               text not null check (type in ('income', 'expense')),
  entry_date         date not null,
  amount_cents       integer not null check (amount_cents >= 0),
  description        text not null default '',
  category           text not null default 'uncategorized',
  job_id             bigint,
  receipt_path       text,
  source             text not null default 'manual' check (source in ('manual', 'csv', 'plaid')),
  bank_transaction_id uuid,
  created_by         text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists books_entries_employer_date_idx on public.books_entries (employer_id, entry_date desc);
create index if not exists books_entries_job_idx on public.books_entries (employer_id, job_id) where job_id is not null;

alter table public.books_entries enable row level security;
revoke all on public.books_entries from public, anon, authenticated;
grant select, insert, update, delete on public.books_entries to service_role;
