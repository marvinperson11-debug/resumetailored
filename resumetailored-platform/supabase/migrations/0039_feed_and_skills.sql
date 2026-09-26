-- Team Feed (both sides) + Skills Matrix.
--
-- Feed: one shared, per-employer wall. `feed_posts.author_kind` distinguishes
-- an employer-side post from an employee-side one; `author_name` is a
-- snapshot (not a join) so a post still reads correctly after the author is
-- renamed or offboarded, same reasoning as `activity_events.title`.
-- `feed_comments` denormalizes `employer_id` too (not just `post_id`) so it
-- can carry the same owner-scoped RLS policy as every other table here
-- without a join, and so a comment can be listed/counted without first
-- loading its parent post.
--
-- Skills: `skills` is an employer's own taxonomy (free-text names they define);
-- `employee_skills` is the matrix cell — one row per (employee, skill) with a
-- 1-5 level. Both denormalize `employer_id` for the same RLS reason.
--
-- Same service-role + employer_id-scoped RLS pattern as every other table
-- here. HAND-APPLIED, idempotent, safe to re-run.

create table if not exists public.feed_posts (
  id bigint generated always as identity primary key,
  employer_id text not null,
  author_kind text not null, -- 'employer' | 'employee'
  author_id text not null,   -- employer: Clerk userId. employee: employees.id as text.
  author_name text not null,
  kind text not null default 'post', -- 'post' | 'issue' | 'win'
  body text not null,
  pinned boolean not null default false,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists feed_posts_employer_idx on public.feed_posts (employer_id, pinned desc, created_at desc);

alter table public.feed_posts enable row level security;
drop policy if exists feed_posts_owner on public.feed_posts;
create policy feed_posts_owner on public.feed_posts
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

create table if not exists public.feed_comments (
  id bigint generated always as identity primary key,
  employer_id text not null,
  post_id bigint not null references public.feed_posts(id) on delete cascade,
  author_kind text not null,
  author_id text not null,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists feed_comments_post_idx on public.feed_comments (post_id, created_at asc);

alter table public.feed_comments enable row level security;
drop policy if exists feed_comments_owner on public.feed_comments;
create policy feed_comments_owner on public.feed_comments
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

create table if not exists public.skills (
  id bigint generated always as identity primary key,
  employer_id text not null,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists skills_employer_idx on public.skills (employer_id, name);

alter table public.skills enable row level security;
drop policy if exists skills_owner on public.skills;
create policy skills_owner on public.skills
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);

create table if not exists public.employee_skills (
  employer_id text not null,
  employee_id bigint not null references public.employees(id) on delete cascade,
  skill_id bigint not null references public.skills(id) on delete cascade,
  level integer not null default 1 check (level >= 1 and level <= 5),
  updated_at timestamptz not null default now(),
  primary key (employee_id, skill_id)
);
create index if not exists employee_skills_employer_idx on public.employee_skills (employer_id);
create index if not exists employee_skills_skill_idx on public.employee_skills (skill_id);

alter table public.employee_skills enable row level security;
drop policy if exists employee_skills_owner on public.employee_skills;
create policy employee_skills_owner on public.employee_skills
  for all
  using (employer_id = auth.uid()::text)
  with check (employer_id = auth.uid()::text);
