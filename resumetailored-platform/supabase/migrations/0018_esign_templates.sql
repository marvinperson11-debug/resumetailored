-- Employer E-Signatures — editable document templates + the "writeup" doc type.
-- Same service-role + employer_id-scoped pattern as 0012 / 0016 / 0017: the
-- server reads/writes with the service-role key, RLS is owner-only defense in
-- depth. `employer_id` is the Clerk user id (TEXT), so auth.uid() is cast
-- ::text. Idempotent throughout — safe to run on a fresh or existing DB.

-- ── Editable templates ────────────────────────────────────────────────────────
-- One row per (employer, doc_type) for the generated document types. `body_html`
-- holds the employer's editable letter text with merge-field tokens
-- ({{candidate_name}}, {{position}}, … , {{signature_block}}); defaults are
-- seeded from the built-in builders in lib/docusign.ts on first use.
create table if not exists public.esign_templates (
  id bigint generated always as identity primary key,
  employer_id text not null,
  doc_type text not null check (doc_type in ('offer', 'agreement', 'nda')),
  name text,
  subject text,
  body_html text,
  updated_at timestamptz not null default now(),
  unique (employer_id, doc_type)
);
create index if not exists esign_templates_employer_idx on public.esign_templates (employer_id);

alter table public.esign_templates enable row level security;

drop policy if exists esign_templates_owner on public.esign_templates;
create policy esign_templates_owner on public.esign_templates
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

-- ── "writeup" document type ───────────────────────────────────────────────────
-- Employee write-up / disciplinary form — a new generated document type sent to
-- an existing employee (signer entered manually, not tied to an applicant).
-- Extend the docusign_envelopes doc_type CHECK (added in 0017) to allow it.
alter table public.docusign_envelopes drop constraint if exists docusign_envelopes_doc_type_check;
alter table public.docusign_envelopes add constraint docusign_envelopes_doc_type_check
  check (doc_type in ('offer', 'agreement', 'nda', 'custom', 'writeup'));
