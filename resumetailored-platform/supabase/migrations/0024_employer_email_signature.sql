-- Sender identity: a branded email signature for every employer-triggered email
-- (interview invites/cancellations, e-sign sends/completion/upload confirmations/
-- doc requests, team invites) + a public bucket for the signature logo/photo.
--
-- Follows the existing employer patterns exactly: the server writes everything
-- with the service-role key (scoped by user_id), so RLS stays enabled with an
-- owner-only folder policy as defense-in-depth for any direct (authenticated)
-- storage access. `user_id` is the Clerk user id (TEXT), so auth.uid() is cast
-- ::text.
--
-- HAND-APPLIED: run this against the Supabase project before deploying. It is
-- idempotent (add column if not exists / on conflict do nothing / drop policy if
-- exists), so it is safe on a fresh or existing DB, and safe to re-run.

-- ── Employer email signature ──────────────────────────────────────────────────
-- email_signature: the branded sign-off appended to outgoing employer emails.
--   null  = not configured (keep today's default footer only)
--   shape = { "displayName", "title", "phone", "address", "footer", "logoUrl" }
--   logoUrl is the PUBLIC url of the uploaded logo/photo (public read is
--   required — private buckets can't render an image inside an email client).
alter table public.employer_profiles
  add column if not exists email_signature jsonb;

-- ── Public bucket: employer-email-assets ──────────────────────────────────────
-- Holds the employer's email-signature logo/photo. PUBLIC on purpose: email
-- clients fetch the image over an unauthenticated URL, so a private bucket would
-- render as a broken image. The server uploads with the service-role key; the
-- folder policies below confine any direct authenticated write to the employer's
-- own {employer_id}/ folder. Objects live under `{employer_id}/{filename}`.
insert into storage.buckets (id, name, public)
values ('employer-email-assets', 'employer-email-assets', true)
on conflict (id) do nothing;

drop policy if exists employer_email_assets_insert on storage.objects;
create policy employer_email_assets_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'employer-email-assets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists employer_email_assets_update on storage.objects;
create policy employer_email_assets_update on storage.objects
  for update to authenticated
  using (bucket_id = 'employer-email-assets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'employer-email-assets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists employer_email_assets_delete on storage.objects;
create policy employer_email_assets_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'employer-email-assets' and (storage.foldername(name))[1] = auth.uid()::text);
