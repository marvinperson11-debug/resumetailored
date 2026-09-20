-- Documents (Document Creator). In-app, Word-like documents an employer composes
-- and can then send for e-signature (rendered to PDF via the existing HTML→PDF
-- envelope path). Same service-role + employer_id-scoped pattern as
-- esign_templates (0018): the server reads/writes with the service-role key, RLS
-- is owner-only defense in depth. `employer_id` is the Clerk user id (TEXT), so
-- auth.uid() is cast ::text.
--
-- HAND-APPLIED: run this against the Supabase project before deploying. It is
-- idempotent (create table if not exists / drop policy if exists), so it is safe
-- on a fresh or existing DB, and safe to re-run.
create table if not exists public.documents (
  id bigint generated always as identity primary key,
  employer_id text not null,
  title text not null,
  body_html text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists documents_employer_idx on public.documents (employer_id, updated_at desc);

alter table public.documents enable row level security;

drop policy if exists documents_owner on public.documents;
create policy documents_owner on public.documents
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);
