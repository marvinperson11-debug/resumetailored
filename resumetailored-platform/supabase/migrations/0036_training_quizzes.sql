-- Training quiz system (Phase 3, item 10b).
--
-- One quiz per training doc (unique fk). `questions` is a JSON array of
-- { q, choices[], correctIndex } — never sent to the employee's own GET route
-- with correctIndex included; the server strips it and scores server-side.
-- Same service-role + employer_id-scoped pattern as the other employer tables.
--
-- HAND-APPLIED: run this against the Supabase project before deploying. It is
-- idempotent (create ... if not exists / drop policy if exists) and safe to
-- re-run.

create table if not exists public.training_quizzes (
  id bigint generated always as identity primary key,
  employer_id text not null,
  training_doc_id bigint not null references public.training_docs(id) on delete cascade,
  questions jsonb not null default '[]'::jsonb,
  pass_threshold int not null default 80,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (training_doc_id)
);
create index if not exists training_quizzes_employer_idx on public.training_quizzes (employer_id);

alter table public.training_quizzes enable row level security;
drop policy if exists training_quizzes_owner on public.training_quizzes;
create policy training_quizzes_owner on public.training_quizzes
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);
