-- Employer Portal AI Assistant — runner-up (silver-medalist) pool (Prompt 4).
--
-- Trigger for the runner-up scan (lib/assistant-runner-up.ts, ticked from the
-- existing 30-minute instrumentation.ts loop): a job published in the last
-- 24h that hasn't been scanned yet. This flag is set once per job regardless
-- of outcome (candidates found or not) so a quiet job is never rescanned —
-- see the scan's own comment for why "no candidates" still sets it.
--
-- Pure ALTER TABLE on an existing table — same no-new-grants precedent as
-- 0054/0055/0058. HAND-APPLIED, idempotent, safe to re-run.

alter table public.job_postings add column if not exists runner_up_scanned boolean not null default false;
