-- 0021: ensure interviews.updated_at exists (heal live schema drift).
--
-- Symptom: on prod, attaching a Daily room (setInterviewRoom) and any status
-- change (updateInterview — e.g. Reopen/Complete/Cancel) silently did nothing.
-- Both write `updated_at`; the SELECT column list does NOT include it, so reads
-- kept working while every write that set `updated_at` failed with
-- "column \"updated_at\" of relation \"interviews\" does not exist".
--
-- 0016 added this column via `add column if not exists`, but only if that ALTER
-- block was applied to the live table (this project runs migrations by hand).
-- This migration re-asserts it independently. Idempotent — safe to re-run, and
-- a no-op if the column already exists.
alter table public.interviews
  add column if not exists updated_at timestamptz not null default now();
