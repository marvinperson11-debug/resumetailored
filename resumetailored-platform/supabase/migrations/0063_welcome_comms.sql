-- Welcome email (platform-only): one-send-ever state per signed-up user.
--
-- A Clerk `user.created` webhook delivery (app/api/webhooks/clerk-welcome)
-- inserts a 'pending' row immediately but sends nothing from the webhook
-- itself — the 15s instrumentation.ts loop (lib/welcome-email.ts
-- runWelcomeScan) picks it up once it is older than WELCOME_GRACE_MINUTES,
-- by which point an employer-path signup (app/api/employer/claim-free, or
-- the legacy Stripe webhook's plan sync via a later `user.updated`
-- delivery) has usually already written `plan:"employer"` to
-- publicMetadata, so the grace window is what lets a single signup pick up
-- the right version instead of always defaulting to candidate.
--
-- `state` is the ENTIRE enforcement point for "sent exactly once, ever":
-- lib/welcome-email.ts `decideAndSend` only ever sends after an atomic
-- `UPDATE ... WHERE state = 'pending' RETURNING *` claims the row, so the
-- grace scan, the claim-free fast path, and a `user.updated` delivery can
-- all call it for the same user without risking a second send — whichever
-- call reaches the database first flips the row to 'welcomed' and every
-- other call sees zero rows.
--
-- Same access pattern as every other backend-only table in the Employer
-- Portal AI Assistant feature set (0051/0052/0053/0056/0058/0061):
-- service-role only, RLS on with no policies, explicit grants (no
-- anon/authenticated access). HAND-APPLIED, idempotent, safe to re-run.

create table if not exists public.welcome_comms (
  user_id text primary key,
  state text not null default 'pending' check (state in ('pending', 'welcomed')),
  version text check (version in ('candidate', 'employer')),
  created_at timestamptz not null default now(),
  welcomed_at timestamptz
);

alter table public.welcome_comms enable row level security;

revoke all on public.welcome_comms from public, anon, authenticated;
grant select, insert, update on public.welcome_comms to service_role;
