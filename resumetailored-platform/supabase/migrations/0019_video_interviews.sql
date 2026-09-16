-- Employer Portal — Video Interviews (Daily.co): auto-generated meeting rooms,
-- recording, transcription, and AI summaries. Same service-role + employer_id
-- pattern as 0012 / 0016. Idempotent — safe to run on a fresh or existing DB.

-- ── Interview columns ─────────────────────────────────────────────────────────
-- room_url/room_name: the Daily room (created on schedule). recording_url/
-- transcript_url: private Storage URLs, filled by the Daily webhook when a
-- recording is ready. ai_summary: structured Claude summary (Scale+ tiers).
-- record_enabled: whether recording was requested (and allowed) for this room.
alter table public.interviews add column if not exists room_url text;
alter table public.interviews add column if not exists room_name text;
alter table public.interviews add column if not exists recording_url text;
alter table public.interviews add column if not exists transcript_url text;
alter table public.interviews add column if not exists ai_summary jsonb;
alter table public.interviews add column if not exists record_enabled boolean default false;

-- ── Recording storage ─────────────────────────────────────────────────────────
-- A PRIVATE bucket for interview recordings + transcripts. The server uploads +
-- reads with the service-role key (bypasses RLS); these policies confine any
-- direct authenticated access to the employer's own {clerkUserId}/ folder — the
-- same first-folder = auth.uid()::text pattern used by the other private buckets.
insert into storage.buckets (id, name, public)
values ('interview-recordings', 'interview-recordings', false)
on conflict (id) do nothing;

drop policy if exists interview_recordings_insert on storage.objects;
create policy interview_recordings_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'interview-recordings' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists interview_recordings_select on storage.objects;
create policy interview_recordings_select on storage.objects
  for select to authenticated
  using (bucket_id = 'interview-recordings' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists interview_recordings_delete on storage.objects;
create policy interview_recordings_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'interview-recordings' and (storage.foldername(name))[1] = auth.uid()::text);
