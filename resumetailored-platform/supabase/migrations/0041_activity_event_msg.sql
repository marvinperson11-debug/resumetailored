-- 0041 — structured, translatable notification text.
--
-- `activity_events.title` / `.body` are written in English at event time.
-- `msg` carries the same event as { "key": "<message id>", "params": {...} }
-- so the bell can render the title in the viewer's language (messages/*.json
-- → notificationBell.events.<key>). Old rows have msg = null and keep showing
-- their stored English title; nothing is backfilled.
--
-- HAND-APPLIED, idempotent, safe to re-run. The app tolerates the column
-- being absent (inserts retry without it), so the order of deploy vs. running
-- this does not matter — until it is applied, new events just stay English.

alter table public.activity_events add column if not exists msg jsonb;
