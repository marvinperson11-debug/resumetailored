-- ONE-OFF data cleanup (NOT a migration — do not move into supabase/migrations).
-- Run by hand in the Supabase SQL editor against production. Each block previews
-- first (SELECT); only the DELETE/UPDATE in the same block changes data, and each is
-- scoped to the exact rows described. Nothing else is touched.

-- 1) Synthetic "Sam Lee" candidate resume (placeholder template content).
select user_id, id, title, updated_at from public.resume_drafts
 where content::text ilike '%samlee@example.com%' or (content::text ilike '%Sam Lee%' and content::text ilike '%TechCorp%');
-- delete from public.resume_drafts
--  where content::text ilike '%samlee@example.com%' or (content::text ilike '%Sam Lee%' and content::text ilike '%TechCorp%');

-- 2) "Training signed: Training training" activity entry = a signed acknowledgment of a
--    training doc titled "Training training". Delete that doc's acknowledgments, then the doc.
select d.id as doc_id, d.employer_id, d.title, a.id as ack_id, a.status, a.acknowledged_at
  from public.training_docs d left join public.acknowledgments a on a.training_doc_id = d.id
 where lower(d.title) = 'training training';
-- delete from public.acknowledgments where training_doc_id in (select id from public.training_docs where lower(title) = 'training training');
-- delete from public.training_docs where lower(title) = 'training training';

-- 3) Admin display name: "Marvin person" -> "Marvin Person" (employee records only).
select id, employer_id, name from public.employees where name = 'Marvin person';
-- update public.employees set name = 'Marvin Person' where name = 'Marvin person';
-- (A Clerk profile name is edited in the Clerk dashboard / account settings, not in SQL.)
