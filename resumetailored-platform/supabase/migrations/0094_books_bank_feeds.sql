-- Books V1 (3/4) — Plaid-backed bank feeds (Corporate-tier "full Books").
--
-- `books_bank_accounts` holds one row per connected Plaid Item (an "item" in
-- Plaid's model can cover several real bank accounts, but V1 treats the
-- whole item as one connection — enough for a small business's single
-- operating account). `plaid_access_token` is Plaid's own long-lived
-- secret; it never leaves the server (lib/books-plaid.ts is the only code
-- that reads this column) and this table is service-role-only exactly like
-- every other one here, so the same RLS-with-no-policy defense applies.
--
-- `books_bank_transactions` mirrors Plaid's own transaction feed; matching
-- against an existing entry/invoice is a review step the employer confirms
-- (match_status), never automatic posting.
--
-- Same access pattern as every table created after the 2026-10-30 cutoff:
-- service-role only, RLS on with no policies, explicit grants. HAND-APPLIED,
-- idempotent, safe to re-run against the Supabase project before deploying.

create table if not exists public.books_bank_accounts (
  id                  uuid primary key default gen_random_uuid(),
  employer_id         text not null,
  plaid_item_id       text not null,
  plaid_access_token  text not null,
  institution_name    text,
  account_name        text,
  account_mask        text,
  status              text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  -- Plaid's own `/transactions/sync` pagination cursor — null means "never
  -- synced yet" (sync from the beginning of the item's history).
  sync_cursor         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists books_bank_accounts_item_idx on public.books_bank_accounts (plaid_item_id);
create index if not exists books_bank_accounts_employer_idx on public.books_bank_accounts (employer_id);

create table if not exists public.books_bank_transactions (
  id                     uuid primary key default gen_random_uuid(),
  employer_id            text not null,
  bank_account_id        uuid not null references public.books_bank_accounts(id) on delete cascade,
  plaid_transaction_id   text not null,
  txn_date               date not null,
  amount_cents           integer not null,
  name                   text not null default '',
  merchant_name          text,
  pending                boolean not null default false,
  match_status           text not null default 'unmatched' check (match_status in ('unmatched', 'matched', 'ignored')),
  matched_entry_id       uuid references public.books_entries(id) on delete set null,
  matched_invoice_id     uuid references public.books_invoices(id) on delete set null,
  created_at             timestamptz not null default now()
);

create unique index if not exists books_bank_transactions_plaid_idx on public.books_bank_transactions (plaid_transaction_id);
create index if not exists books_bank_transactions_employer_idx on public.books_bank_transactions (employer_id, txn_date desc);
create index if not exists books_bank_transactions_unmatched_idx on public.books_bank_transactions (employer_id, match_status);

alter table public.books_bank_accounts enable row level security;
alter table public.books_bank_transactions enable row level security;
revoke all on public.books_bank_accounts from public, anon, authenticated;
revoke all on public.books_bank_transactions from public, anon, authenticated;
grant select, insert, update, delete on public.books_bank_accounts to service_role;
grant select, insert, update, delete on public.books_bank_transactions to service_role;
