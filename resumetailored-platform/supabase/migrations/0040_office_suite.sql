-- Office suite (Phase 4: Calculators + Charts).
--
-- Calculators are pure client-side math — nothing to persist. Charts need two
-- things: a way to tell a chart-backed document apart from a plain composed
-- one, and somewhere public to put the rendered PNG (a Document Creator
-- document embeds it as an <img>, which needs an unauthenticated URL).
--
-- Same service-role + employer_id-scoped pattern as every other table/bucket
-- here (e.g. 0024's employer-email-assets). HAND-APPLIED, idempotent, safe to
-- re-run.

-- ── documents: chart-backed rows ────────────────────────────────────────────
alter table public.documents
  add column if not exists kind text not null default 'html';
alter table public.documents
  add column if not exists asset_url text;

-- ── Public bucket: office-assets ────────────────────────────────────────────
-- Holds chart PNGs from "Insert into a document". PUBLIC on purpose: the PNG
-- is embedded as a plain <img src="…"> in a document's body_html, which (like
-- the email-signature logo) needs an unauthenticated URL to render. The server
-- uploads with the service-role key; the folder policies below confine any
-- direct authenticated write to the employer's own {employer_id}/ folder.
-- Objects live under `{employer_id}/{filename}`.
insert into storage.buckets (id, name, public)
values ('office-assets', 'office-assets', true)
on conflict (id) do nothing;

drop policy if exists office_assets_insert on storage.objects;
create policy office_assets_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'office-assets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists office_assets_update on storage.objects;
create policy office_assets_update on storage.objects
  for update to authenticated
  using (bucket_id = 'office-assets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'office-assets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists office_assets_delete on storage.objects;
create policy office_assets_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'office-assets' and (storage.foldername(name))[1] = auth.uid()::text);
