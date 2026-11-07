-- Books V1 (2/4) — simple invoicing. Records + reminders only: no payment
-- processing, no Stripe, no money movement. `line_items_json` is
-- `{description, quantity, unitPriceCents}[]`; `amount_cents` is the stored
-- total at creation time (recomputed on edit, never recomputed silently on
-- read) so a later price-list change can't rewrite what a sent invoice said.
--
-- Same access pattern as every table created after the 2026-10-30 cutoff:
-- service-role only, RLS on with no policies, explicit grants. HAND-APPLIED,
-- idempotent, safe to re-run against the Supabase project before deploying.

create table if not exists public.books_invoices (
  id                uuid primary key default gen_random_uuid(),
  employer_id       text not null,
  invoice_number    text not null,
  client_name       text not null,
  client_email      text,
  issue_date        date not null,
  due_date          date not null,
  line_items_json   jsonb not null default '[]'::jsonb,
  amount_cents      integer not null check (amount_cents >= 0),
  status            text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'overdue', 'void')),
  sent_at           timestamptz,
  paid_at           timestamptz,
  last_reminder_at  timestamptz,
  created_by        text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists books_invoices_employer_number_idx on public.books_invoices (employer_id, invoice_number);
create index if not exists books_invoices_employer_status_idx on public.books_invoices (employer_id, status, due_date);

alter table public.books_invoices enable row level security;
revoke all on public.books_invoices from public, anon, authenticated;
grant select, insert, update, delete on public.books_invoices to service_role;
