-- Employee Hub (Poka-inspired), Part A + B: the employer's own workforce, plus
-- training documents and per-employee acknowledgments.
--
-- Same service-role + employer_id-scoped pattern as documents (0027) and
-- esign_templates (0018): the server reads/writes with the service-role key,
-- RLS owner-only is defense in depth. `employer_id` is the Clerk user id (TEXT),
-- so auth.uid() is cast ::text.
--
-- HAND-APPLIED: run this against the Supabase project before deploying. It is
-- idempotent (create ... if not exists / drop policy if exists), so it is safe
-- on a fresh or existing DB, and safe to re-run.

-- ── A. Employees ─────────────────────────────────────────────────────────────
create table if not exists public.employees (
  id bigint generated always as identity primary key,
  employer_id text not null,
  name text not null,
  email text,
  role text,
  start_date date,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists employees_employer_idx on public.employees (employer_id, created_at desc);

alter table public.employees enable row level security;
drop policy if exists employees_owner on public.employees;
create policy employees_owner on public.employees
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

-- ── B. Training documents ────────────────────────────────────────────────────
-- Authored in the Documents creator ("Use in training" → source_document_id) or
-- uploaded as a PDF fallback (pdf_url). assign_to is 'all' or a specific role
-- name. require_signature ON routes each acknowledgment through the existing
-- E-Signatures flow.
create table if not exists public.training_docs (
  id bigint generated always as identity primary key,
  employer_id text not null,
  title text not null,
  doc_kind text not null default 'policy',
  body_html text,
  source_document_id bigint,
  pdf_url text,
  assign_to text not null default 'all',
  require_signature boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists training_docs_employer_idx on public.training_docs (employer_id, created_at desc);

alter table public.training_docs enable row level security;
drop policy if exists training_docs_owner on public.training_docs;
create policy training_docs_owner on public.training_docs
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

-- ── B. Acknowledgments ───────────────────────────────────────────────────────
-- One row per (training_doc, employee). envelope_id links to the DocuSign
-- envelope when a signature is required; the webhook flips status to 'signed'
-- on completion. score/attempts carry the optional quiz result (Part E).
create table if not exists public.acknowledgments (
  id bigint generated always as identity primary key,
  employer_id text not null,
  training_doc_id bigint not null references public.training_docs(id) on delete cascade,
  employee_id bigint not null references public.employees(id) on delete cascade,
  envelope_id text,
  status text not null default 'pending',
  due_at timestamptz,
  acknowledged_at timestamptz,
  score int,
  attempts int not null default 0,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (training_doc_id, employee_id)
);
create index if not exists acknowledgments_employer_idx on public.acknowledgments (employer_id);
create index if not exists acknowledgments_doc_idx on public.acknowledgments (training_doc_id);
create index if not exists acknowledgments_employee_idx on public.acknowledgments (employee_id);
create index if not exists acknowledgments_envelope_idx on public.acknowledgments (envelope_id);

alter table public.acknowledgments enable row level security;
drop policy if exists acknowledgments_owner on public.acknowledgments;
create policy acknowledgments_owner on public.acknowledgments
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);
