-- 0046 — Resume Video settings, saved per user so the voice, background colour and headshot
-- (plus where it sits and whether it shows on every slide) are remembered between videos.
-- One jsonb column on the existing user_prefs row (0042); the headshot is a small, client-downsized
-- jpeg/png data URL inside it, so no storage bucket is needed. Additive and idempotent.

alter table public.user_prefs add column if not exists video_settings jsonb;
