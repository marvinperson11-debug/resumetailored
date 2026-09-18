-- 0022: store Daily's cloud recording reference instead of uploading the video.
--
-- Interview recordings are ~100MB+ (2 min), which exceeds Supabase Storage's
-- 50MB per-object limit → the webhook upload 413'd and the interview never
-- completed. We now keep the video in Daily's cloud and store only its
-- recording id here; a download route fetches a fresh signed URL from Daily on
-- demand. Transcript/audio (small) still archive to the interview-recordings
-- bucket. Idempotent — apply by hand.
alter table public.interviews
  add column if not exists recording_id text;
