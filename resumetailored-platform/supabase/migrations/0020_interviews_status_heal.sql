-- 0020: heal interviews.status drift.
--
-- The live `interviews` table was created before 0016's canonical definition
-- (`status text not null default 'scheduled' check (status in
-- ('scheduled','completed','cancelled'))`). On the drifted table the column
-- default is 'pending' and the CHECK is missing, so a scheduled video interview
-- inserts as 'pending' — an out-of-vocabulary value the Scheduler UI treats as
-- not-scheduled, so the Join button never renders even though the Daily room was
-- created successfully.
--
-- The app now sets status explicitly on insert (belt-and-suspenders), but this
-- also (a) backfills existing drifted rows, (b) corrects the column default, and
-- (c) (re)installs the CHECK so 'pending' can never recur. Idempotent — safe to
-- run repeatedly. Apply by hand (this project runs migrations manually).

-- (a) Backfill any non-canonical status (e.g. 'pending', NULL) to 'scheduled'.
update public.interviews
   set status = 'scheduled'
 where status is null
    or status not in ('scheduled', 'completed', 'cancelled');

-- (b) Correct the column default.
alter table public.interviews alter column status set default 'scheduled';
alter table public.interviews alter column status set not null;

-- (c) (Re)install the canonical CHECK constraint.
alter table public.interviews drop constraint if exists interviews_status_check;
alter table public.interviews
  add constraint interviews_status_check
  check (status in ('scheduled', 'completed', 'cancelled'));
