-- Employer Portal Phase 1B — DocuSign eSignature for offer letters (feature #10).
-- Follows the same pattern as 0012_employer.sql / 0016: the server does every
-- read and write with the service-role key (each query scoped by employer_id),
-- so RLS is enabled with an owner-only policy as defense-in-depth for any direct
-- (anon/authenticated) access. `employer_id` is the Clerk user id (TEXT, e.g.
-- user_3Iy2u…), NOT a uuid, so auth.uid() is cast with ::text.
--
-- Idempotent throughout (CREATE TABLE IF NOT EXISTS / add column if not exists /
-- drop policy if exists), so it is safe to run on a fresh or an existing DB.

-- ── OAuth token cache ─────────────────────────────────────────────────────────
-- One DocuSign connection per employer (Authorization Code Grant). The refresh
-- token is the long-lived credential and is stored ENCRYPTED at rest
-- (AES-256-GCM, see lib/docusign.ts); the short-lived access token is cached
-- alongside its expiry so a send doesn't re-mint on every request. This table is
-- only ever touched by the service-role key and carries no public RLS policy, so
-- tokens are never reachable from the browser.
create table if not exists public.docusign_connections (
  employer_id text primary key,
  account_id text,
  account_name text,
  account_email text,
  base_uri text,                       -- e.g. https://demo.docusign.net (no /restapi)
  access_token text,                   -- short-lived; refreshed on demand
  access_token_expires_at timestamptz,
  refresh_token text,                  -- encrypted at rest (enc:v1:… ) or plaintext fallback
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.docusign_connections enable row level security;
-- No policy is created: with RLS enabled and no policy, anon/authenticated get
-- zero rows. Only the service-role key (which bypasses RLS) can read/write here.

-- ── Envelopes ─────────────────────────────────────────────────────────────────
-- One row per offer-letter envelope sent through DocuSign. `offer` holds the
-- structured terms the letter was generated from (position, salary, start_date,
-- extra terms). `status` mirrors the DocuSign envelope lifecycle and is synced
-- by the Connect webhook and the fallback poll.
create table if not exists public.docusign_envelopes (
  id bigint generated always as identity primary key,
  employer_id text not null,
  applicant_id bigint references public.applicants(id) on delete set null,
  shortlist_member_id bigint references public.shortlist_members(id) on delete set null,
  envelope_id text unique,
  subject text,
  message text,
  status text not null default 'sent'
    check (status in ('sent','delivered','viewed','signed','declined','completed','voided')),
  offer jsonb not null default '{}'::jsonb,
  candidate_name text,
  candidate_email text,
  sent_by text,
  sent_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists docusign_envelopes_employer_idx
  on public.docusign_envelopes (employer_id, sent_at desc);
create index if not exists docusign_envelopes_envelope_idx
  on public.docusign_envelopes (envelope_id);
create index if not exists docusign_envelopes_applicant_idx
  on public.docusign_envelopes (applicant_id, sent_at desc);

-- Heal a DB where the table predates these columns (all no-ops on a fresh DB).
alter table public.docusign_envelopes add column if not exists candidate_name text;
alter table public.docusign_envelopes add column if not exists candidate_email text;
alter table public.docusign_envelopes add column if not exists shortlist_member_id bigint;

alter table public.docusign_envelopes enable row level security;

drop policy if exists docusign_envelopes_owner on public.docusign_envelopes;
create policy docusign_envelopes_owner on public.docusign_envelopes
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);
