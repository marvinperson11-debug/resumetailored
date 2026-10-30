-- One surface, not two (Taylor Combined Build v5, Section F): backfills the
-- Kanban tracker (tracked_applications / application_events, migrations
-- 0078/0079) from the older hand-entry `applications` table (migration
-- 0004), which /candidate/applications now 301-redirects away from
-- (middleware.ts). Pure data pass — no column or table is added, so there
-- is nothing new to GRANT here; every row this writes lands in tables whose
-- GRANTs already exist (0078/0079).
--
-- HAND-APPLIED, idempotent, safe to re-run: a legacy row is skipped once an
-- application_events row already records it (event in
-- ('migrated_from_legacy','legacy_merge') with payload->>'legacy_id' equal
-- to its id) — that event doubles as both the audit trail (required) and
-- the re-run guard, rather than adding a tracking column to either table.
--
-- Status -> stage mapping (against the REAL `applications.status` check
-- constraint — 'Applied','Phone Screen','Interview','Offer','Rejected',
-- 'Ghosted','Withdrawn' — not the generic list the build spec guessed):
--   Applied                 -> Applied
--   Phone Screen, Interview -> Interviewing
--   Offer                   -> Offer
--   Rejected                -> Rejected
--   Withdrawn               -> Withdrawn
--   Ghosted, NULL/empty/anything unrecognized -> Clipped
--     (the original status string is preserved in the card's notes either way)
--
-- Field mapping (old -> new; adjusted to the REAL legacy schema, which has
-- `role`/no `description`/no `title`, not the generic names the build spec
-- assumed):
--   role       -> job_title
--   company    -> company
--   location   -> location
--   url        -> posting_url (also the dedupe key)
--   applied_at -> applied_at when the chosen stage is Applied-ish
--                 (Applied/Interviewing/Offer/Rejected/Withdrawn),
--                 else only stage_changed_at (a Clipped card was never
--                 actually "applied" in the new model's sense)
--   (no `description` column exists on the legacy table — left unmapped,
--   nothing invented to fill it)
-- Legacy fields with NO destination column on tracked_applications
-- (salary, contact_name, contact_email, follow_up_date, resume_id, notes)
-- are never dropped — preserved verbatim as one system note on the card,
-- so no candidate data is lost even though the new schema has nowhere
-- structured to put them.
--
-- DEDUPE: a legacy row sharing (user_id, posting_url) with an existing
-- tracked_applications row (from either the Kanban tracker already being
-- used in parallel, or an earlier migrated legacy row) merges into that
-- card — its extra fields are appended as a note, and an
-- `application_events` row of type 'legacy_merge' (not
-- 'migrated_from_legacy') records the merge — rather than creating a
-- second card for the same posting.
--
-- UNMAPPABLE (flagged, never guessed): a legacy row where BOTH `role` and
-- `company` are blank after trimming has nothing to identify the
-- application by — there is no honest card to create. These rows are left
-- untouched in `applications` (still readable there) and are NOT migrated;
-- query them after running this with:
--   select id, company, role, status from public.applications
--   where coalesce(trim(role), '') = '' and coalesce(trim(company), '') = '';

do $$
declare
  r record;
  v_stage text;
  v_tracked_id uuid;
  v_existing_id uuid;
  v_notes jsonb;
  v_extra text;
  v_applied_at timestamptz;
  v_stage_changed_at timestamptz;
  n_migrated int := 0;
  n_merged int := 0;
  n_unmappable int := 0;
begin
  for r in
    select a.*
    from public.applications a
    where not exists (
      select 1 from public.application_events e
      where e.event in ('migrated_from_legacy', 'legacy_merge')
        and e.payload ->> 'legacy_id' = a.id::text
    )
  loop
    if coalesce(trim(r.role), '') = '' and coalesce(trim(r.company), '') = '' then
      n_unmappable := n_unmappable + 1;
      continue;
    end if;

    v_stage := case r.status
      when 'Applied' then 'Applied'
      when 'Phone Screen' then 'Interviewing'
      when 'Interview' then 'Interviewing'
      when 'Offer' then 'Offer'
      when 'Rejected' then 'Rejected'
      when 'Withdrawn' then 'Withdrawn'
      else 'Clipped' -- includes 'Ghosted', null, empty, anything unrecognized
    end;

    v_applied_at := case
      when v_stage in ('Applied', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn') then r.applied_at
      else null
    end;
    v_stage_changed_at := coalesce(r.updated_at, r.applied_at, now());

    v_extra := '';
    if r.status is distinct from v_stage then
      v_extra := v_extra || format(E'Migrated from legacy tracker. Original status: %s.\n', coalesce(r.status, '(none)'));
    end if;
    if coalesce(trim(r.salary), '') <> '' then
      v_extra := v_extra || format(E'Salary (legacy): %s\n', r.salary);
    end if;
    if coalesce(trim(r.contact_name), '') <> '' or coalesce(trim(r.contact_email), '') <> '' then
      v_extra := v_extra || format(
        E'Contact (legacy): %s\n',
        trim(coalesce(trim(r.contact_name), '') || case when coalesce(trim(r.contact_email), '') <> '' then ' <' || trim(r.contact_email) || '>' else '' end)
      );
    end if;
    if r.follow_up_date is not null then
      v_extra := v_extra || format(E'Follow-up date (legacy): %s\n', r.follow_up_date);
    end if;
    if coalesce(trim(r.resume_id), '') <> '' then
      v_extra := v_extra || format(E'Resume used (legacy id): %s\n', r.resume_id);
    end if;
    if coalesce(trim(r.notes), '') <> '' then
      v_extra := v_extra || format(E'Notes (legacy): %s\n', r.notes);
    end if;

    v_notes := '[]'::jsonb;
    if v_extra <> '' then
      v_notes := jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'text', trim(trailing E'\n' from v_extra),
        'createdAt', now()
      ));
    end if;

    v_existing_id := null;
    if coalesce(trim(r.url), '') <> '' then
      select id into v_existing_id
      from public.tracked_applications
      where user_id = r.user_id and posting_url = r.url
      order by created_at asc
      limit 1;
    end if;

    if v_existing_id is not null then
      if v_notes <> '[]'::jsonb then
        update public.tracked_applications
        set notes = notes || v_notes,
            updated_at = now()
        where id = v_existing_id;
      end if;

      insert into public.application_events (tracked_application_id, user_id, event, payload)
      values (v_existing_id, r.user_id, 'legacy_merge', jsonb_build_object(
        'legacy_id', r.id,
        'old_status', r.status,
        'chosen_stage', v_stage,
        'merged_into', v_existing_id
      ));

      n_merged := n_merged + 1;
    else
      insert into public.tracked_applications (
        user_id, job_title, company, location, posting_url, source, stage,
        stage_changed_at, applied_at, notes, created_at, updated_at
      ) values (
        r.user_id,
        coalesce(r.role, ''),
        coalesce(r.company, ''),
        r.location,
        nullif(trim(r.url), ''),
        'manual',
        v_stage,
        v_stage_changed_at,
        v_applied_at,
        v_notes,
        coalesce(r.applied_at, now()),
        now()
      )
      returning id into v_tracked_id;

      insert into public.application_events (tracked_application_id, user_id, event, payload)
      values (v_tracked_id, r.user_id, 'migrated_from_legacy', jsonb_build_object(
        'legacy_id', r.id,
        'old_status', r.status,
        'chosen_stage', v_stage
      ));

      n_migrated := n_migrated + 1;
    end if;
  end loop;

  raise notice 'legacy applications migration: migrated=%, merged=%, unmappable=%', n_migrated, n_merged, n_unmappable;
end $$;

-- Legacy table stays in place (deletion deferred to a later, deliberate
-- migration after stable quarters) but is now read-only from app code — see
-- app/api/applications/route.ts (POST) and app/api/applications/[id]/route.ts
-- (PATCH/DELETE), both of which now answer 410 instead of writing.
comment on table public.applications is
  'LEGACY — superseded by tracked_applications (migrations 0078/0079). Read-only from app code as of migration 0081; do not write. Drop deferred to a future migration after stable quarters.';
