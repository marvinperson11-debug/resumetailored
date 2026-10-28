-- Employer Portal AI Assistant — per-employer persona + voice settings
-- (Voice Mode, Prompt 7).
--
-- One row per employer. `assistant_name` is the Assistant's own name,
-- renamable at any time (default "Taylor") — shown in the chat header and
-- used for the assistant's spoken self-reference in the voice layer only
-- (lib/assistant-voice.ts); it never changes the Claude system prompt
-- (lib/assistant-chat.ts `runAssistantTurn` is unchanged by this feature).
--
-- `employer_display_name` is the employer's OWN name as the assistant
-- addresses them — seeded from Clerk `firstName` but only ever written here
-- once the employer confirms (or corrects) it in the first voice session's
-- onboarding exchange (lib/assistant-voice.ts `resolveOnboardingAnswer`);
-- `voice_introduced` gates that one-time exchange so it is never repeated,
-- whether or not the employer accepted the proposed name.
--
-- `tts_voice` / `tts_rate` are the per-account spoken-reply preferences
-- (voice picker + rate), round-tripped through
-- app/api/employer/assistant/persona/route.ts so they sync across devices.
--
-- Same access pattern as every table created after the 2026-10-30 cutoff:
-- service-role only, RLS on with no policies, explicit grants limited to the
-- verbs the server code actually issues. HAND-APPLIED, idempotent, safe to
-- re-run.

create table if not exists public.assistant_persona (
  employer_id text primary key,
  assistant_name text not null default 'Taylor',
  employer_display_name text,
  voice_introduced boolean not null default false,
  tts_voice text,
  tts_rate numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.assistant_persona enable row level security;

revoke all on public.assistant_persona from public, anon, authenticated;
grant select, insert, update on public.assistant_persona to service_role;
