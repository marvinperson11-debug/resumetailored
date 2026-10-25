-- GA4 server-events — platform-side dedupe table (Kimi prompt: free_claim_started /
-- free_claim_completed, Employer Free-Tier Funnel).
--
-- The legacy app (server.js) already fires GA4 key events via Measurement
-- Protocol (signup_completed, pro_checkout_completed, purchase) and dedupes
-- them in its own SQLite `usage_store`. This app has no SQLite — it is
-- Supabase-only — so lib/ga4-events.ts needs its own durable claim table.
-- There is no earlier "Oct 23 GA4 migration" to extend on this side (legacy's
-- dedupe lives in SQLite, not Supabase); this is a new table.
--
-- One row per (user_id, event_name) EVER — free_claim_started and
-- free_claim_completed each fire at most once per Clerk user, for the
-- lifetime of the account, not once per day/attempt (funnel math wants
-- first-attempt signal, not click-storm signal). lib/ga4-events.ts
-- `claimOnce` inserts a row BEFORE sending and deletes it again if the MP
-- call fails, so a row's presence means "this event was actually delivered
-- to GA4 for this user" — the real race guard is the unique index below, not
-- the claim-then-insert order, same idempotency shape
-- lib/assistant-inbound.ts `claimInboundEventKey` already established for
-- this codebase (check-then-insert, unique-violation = duplicate).
--
-- Same access pattern as every other table created after the 2026-10-30
-- cutoff: service-role only, RLS on with no policies, explicit grants (no
-- automatic Data API grants for new tables past that cutoff). HAND-APPLIED,
-- idempotent, safe to re-run.

create table if not exists public.ga4_processed_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  event_name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists ga4_processed_events_user_event_idx
  on public.ga4_processed_events (user_id, event_name);

alter table public.ga4_processed_events enable row level security;

revoke all on public.ga4_processed_events from public, anon, authenticated;
grant select, insert, delete on public.ga4_processed_events to service_role;
