-- Soft delete for employer career sites.
-- An employer can delete their career site from the Career Site page. Deleting sets
-- deleted_at instead of removing the row, so the site content and the employer's job
-- postings are retained and recoverable by us. A row with deleted_at set is treated as
-- "no career site": the public page and its address return not-found, and the employer
-- sees the "create your career site" state (creating again revives the row with a clean
-- default site and keeps the same address). Safe to re-run.
alter table public.career_sites add column if not exists deleted_at timestamptz;
