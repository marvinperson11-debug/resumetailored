-- E-Signatures: "Send a copy" (forward). An employer can email the completed,
-- combined signed PDF + certificate to any name/email via Resend — a plain
-- forward, no DocuSign step. We persist a small log of who a copy was sent to so
-- the detail can show a record.
--
-- HAND-APPLIED: run this against the Supabase project before deploying. It is
-- idempotent (add column if not exists), so it is safe on a fresh or existing
-- DB, and safe to re-run.
--
-- copies_sent: [{ "name", "email", "sentAt" }, …] (default []).
alter table public.docusign_envelopes
  add column if not exists copies_sent jsonb not null default '[]'::jsonb;
