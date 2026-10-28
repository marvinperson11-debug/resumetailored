-- Employer Portal AI Assistant — ElevenLabs TTS audio cache (Voice Fix Round 2, Section B).
--
-- No new table: the cache index IS the deterministic storage path
-- `{voiceKey}/{sha256(voiceKey:text)}.mp3` (lib/assistant-tts.ts `ttsCacheKey`/
-- `cachePath`) — an object existing at that path is the cache hit, so there is
-- nothing a row would track that the path doesn't already encode. The monthly
-- per-employer character cap reuses the existing generic `usage_counters`
-- table (migration 0043) under kind 'assistant_tts_chars' rather than a new
-- table, for the same reason: it is already exactly "a scoped counter keyed
-- by kind + period", atomically bumped via bump_usage_counter.
--
-- Private bucket, service-role access only (same pattern as 'resume-videos',
-- migration 0047) — no storage.objects policies, since the app only ever
-- reads/writes with the service-role key after its own employer-scoped auth
-- check in app/api/employer/assistant/tts/route.ts.
--
-- Same access pattern as every table/bucket created after the 2026-10-30
-- cutoff. HAND-APPLIED, idempotent, safe to re-run.

insert into storage.buckets (id, name, public)
values ('assistant-tts-cache', 'assistant-tts-cache', false)
on conflict (id) do nothing;
