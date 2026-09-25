-- Onboarding Checklists (Phase 3, item 8).
--
-- Same service-role + employer_id-scoped pattern as employees (0029) and time
-- features (0033): the server reads/writes with the service-role key, RLS
-- owner-only is defense in depth. `employer_id` is the Clerk user id (TEXT).
--
-- SEED LIVES IN APP CODE, NOT HERE (same pattern as the Training Library,
-- 0030). This file is schema-only. The default template's six items ("ID
-- collected", "W-4 signed", "Safety training done", "Emergency contact on
-- file", "Direct-deposit info collected", "Uniform issued") are defined in
-- lib/checklist-hub.ts and inserted (idempotently, one default template per
-- employer) by GET /api/employer/checklist-templates/seed?do=1.
--
-- HAND-APPLIED: run this against the Supabase project before deploying. It is
-- idempotent (create ... if not exists / drop policy if exists) and safe to
-- re-run.

-- ── Templates (employer-owned, editable; one may be flagged the default) ────
create table if not exists public.checklist_templates (
  id bigint generated always as identity primary key,
  employer_id text not null,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists checklist_templates_employer_idx on public.checklist_templates (employer_id, created_at desc);

alter table public.checklist_templates enable row level security;
drop policy if exists checklist_templates_owner on public.checklist_templates;
create policy checklist_templates_owner on public.checklist_templates
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

create table if not exists public.checklist_template_items (
  id bigint generated always as identity primary key,
  employer_id text not null,
  template_id bigint not null references public.checklist_templates(id) on delete cascade,
  label text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists checklist_template_items_template_idx on public.checklist_template_items (template_id, sort_order);

alter table public.checklist_template_items enable row level security;
drop policy if exists checklist_template_items_owner on public.checklist_template_items;
create policy checklist_template_items_owner on public.checklist_template_items
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

-- ── Per-employee instantiated checklist ──────────────────────────────────────
-- A snapshot of the template's items at the time it was started, so editing the
-- template later never rewrites a checklist already in progress.
create table if not exists public.employee_checklists (
  id bigint generated always as identity primary key,
  employer_id text not null,
  employee_id bigint not null references public.employees(id) on delete cascade,
  template_id bigint references public.checklist_templates(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists employee_checklists_employer_idx on public.employee_checklists (employer_id);
create index if not exists employee_checklists_employee_idx on public.employee_checklists (employee_id, created_at desc);

alter table public.employee_checklists enable row level security;
drop policy if exists employee_checklists_owner on public.employee_checklists;
create policy employee_checklists_owner on public.employee_checklists
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

create table if not exists public.employee_checklist_items (
  id bigint generated always as identity primary key,
  employer_id text not null,
  checklist_id bigint not null references public.employee_checklists(id) on delete cascade,
  label text not null,
  done boolean not null default false,
  sort_order int not null default 0,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists employee_checklist_items_checklist_idx on public.employee_checklist_items (checklist_id, sort_order);

alter table public.employee_checklist_items enable row level security;
drop policy if exists employee_checklist_items_owner on public.employee_checklist_items;
create policy employee_checklist_items_owner on public.employee_checklist_items
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);
