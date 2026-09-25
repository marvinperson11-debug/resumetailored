-- Certifications (Phase 3, item 9).
--
-- Same service-role + employer_id-scoped pattern as the other employer tables.
-- `employer_id` is the Clerk user id (TEXT). An optional file lives in a
-- private Supabase Storage bucket ("employee-certs"), same shape as the
-- envelope-attachments bucket in docusign-store.ts — file_url stores the
-- bucket-relative storage path, never a public URL.
--
-- HAND-APPLIED: run this against the Supabase project before deploying. It is
-- idempotent (create ... if not exists / drop policy if exists) and safe to
-- re-run.

create table if not exists public.employee_certs (
  id bigint generated always as identity primary key,
  employer_id text not null,
  employee_id bigint not null references public.employees(id) on delete cascade,
  name text not null,
  issued_date date,
  expiry_date date,
  file_url text,
  added_by text not null default 'employer', -- 'employer' | 'employee'
  reminder_30_sent_at timestamptz,
  reminder_7_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists employee_certs_employer_idx on public.employee_certs (employer_id, created_at desc);
create index if not exists employee_certs_employee_idx on public.employee_certs (employee_id);
create index if not exists employee_certs_expiry_idx on public.employee_certs (expiry_date);

alter table public.employee_certs enable row level security;
drop policy if exists employee_certs_owner on public.employee_certs;
create policy employee_certs_owner on public.employee_certs
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);
