-- Application Tracker audit trail (Combined Build, Section 1) — append-only,
-- same shape and same reasoning as assistant_audit_log (migration 0051):
-- every stage change, clip, edit, and nudge fired/dismissed on a tracked
-- application is logged here, scoped by tracked_application_id AND user_id
-- (the second is redundant with the FK but lets lib/tracker-store.ts filter
-- without a join on every read). Never updated or deleted by any code path —
-- this module has no update/delete function, matching assistant-audit.ts's
-- own rule.

create table if not exists public.application_events (
  id                      uuid primary key default gen_random_uuid(),
  tracked_application_id  uuid not null references public.tracked_applications(id) on delete cascade,
  user_id                 text not null,
  event                   text not null,
  payload                 jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now()
);

create index if not exists application_events_app_idx on public.application_events (tracked_application_id, created_at desc);
create index if not exists application_events_user_idx on public.application_events (user_id, created_at desc);

alter table public.application_events enable row level security;

revoke all on public.application_events from public, anon, authenticated;
grant select, insert on public.application_events to service_role;
