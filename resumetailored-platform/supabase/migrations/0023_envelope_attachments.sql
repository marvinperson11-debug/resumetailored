-- E-Signatures: document uploads on both sides of an envelope + signed-document
-- delivery (feature: envelope attachments).
--
-- Follows 0017_docusign_envelopes.sql exactly: the server does every read/write
-- with the service-role key (scoped by employer_id, or by envelope_id + a random
-- per-envelope token for the login-less signer), so RLS is enabled with an
-- owner-only policy as defense-in-depth for any direct (anon/authenticated)
-- access. `employer_id` is the Clerk user id (TEXT), so auth.uid() is cast ::text.
--
-- HAND-APPLIED: run this against the Supabase project before deploying. It is
-- idempotent (add column if not exists / on conflict do nothing / drop policy if
-- exists), so it is safe to run on a fresh or an existing DB, and safe to re-run.

-- ── New envelope columns ──────────────────────────────────────────────────────
-- requested_docs: the named documents the employer asked the signer to upload.
--   [{ "name": "Photo ID", "uploaded": false }, …]
-- attachments: every file attached to this envelope, from either side.
--   [{ "name", "url" (storage path, NOT public), "note", "uploaded_at",
--     "kind": "requested" | "other" }, …]
-- sign_token: a random per-envelope token minted at send time; it is the only
--   credential on the login-less /sign/{envelope_id}?key={token} signer page.
-- signed_docs_emailed_at: idempotency guard so the "Your signed documents"
--   completion email (webhook + fallback poll can both fire) is sent once.
alter table public.docusign_envelopes
  add column if not exists requested_docs jsonb not null default '[]'::jsonb;
alter table public.docusign_envelopes
  add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.docusign_envelopes
  add column if not exists sign_token text;
alter table public.docusign_envelopes
  add column if not exists signed_docs_emailed_at timestamptz;

-- Look up an envelope by its signer token quickly (login-less signer page).
create index if not exists docusign_envelopes_sign_token_idx
  on public.docusign_envelopes (sign_token);

-- ── Private bucket: envelope-attachments ──────────────────────────────────────
-- Holds files uploaded by the signer (requested docs + free-form) and any files
-- the employer attaches to the envelope record. Private: the server uploads +
-- reads with the service-role key, and files are only ever served through an
-- authenticated API route (employer) — never a public URL. Objects live under
-- `{employer_id}/{envelope_id}/…`, so the folder policies below confine any
-- direct authenticated access to the employer's own folder.
insert into storage.buckets (id, name, public)
values ('envelope-attachments', 'envelope-attachments', false)
on conflict (id) do nothing;

drop policy if exists envelope_attachments_insert on storage.objects;
create policy envelope_attachments_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'envelope-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists envelope_attachments_select on storage.objects;
create policy envelope_attachments_select on storage.objects
  for select to authenticated
  using (bucket_id = 'envelope-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists envelope_attachments_delete on storage.objects;
create policy envelope_attachments_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'envelope-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
