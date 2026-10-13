-- Structured document pipeline: vacancies (the ONLY source of employer/position for a run), the batch
-- queue, and the private bucket the generated .docx / .zip files live in.
-- Server-side access only (service-role key, rows scoped by Clerk user_id): RLS on, no public policy.

create table if not exists public.vacancies (
  id               uuid        primary key default gen_random_uuid(),
  user_id          text        not null,
  employer         text        not null,
  position         text        not null,
  description      text        not null default '',
  employer_address text[]      not null default '{}',
  created_at       timestamptz not null default now()
);
create index if not exists vacancies_user_created_idx on public.vacancies (user_id, created_at desc);
alter table public.vacancies enable row level security;

create table if not exists public.document_batches (
  id           uuid        primary key default gen_random_uuid(),
  user_id      text        not null,
  status       text        not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  profile_text text        not null default '',
  zip_path     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists document_batches_user_idx on public.document_batches (user_id, created_at desc);
alter table public.document_batches enable row level security;

create table if not exists public.document_batch_items (
  id          uuid        primary key default gen_random_uuid(),
  batch_id    uuid        not null references public.document_batches (id) on delete cascade,
  user_id     text        not null,
  vacancy_id  uuid        not null references public.vacancies (id) on delete cascade,
  position    int         not null default 0,
  -- needs_review: the resume named an employer/title/date not found in the career profile.
  status      text        not null default 'pending' check (status in ('pending', 'running', 'done', 'needs_review', 'failed')),
  resume_path text,
  cover_path  text,
  flags       jsonb       not null default '[]'::jsonb,
  errors      jsonb       not null default '[]'::jsonb,
  claimed_at  timestamptz,
  updated_at  timestamptz not null default now()
);
create index if not exists document_batch_items_batch_idx on public.document_batch_items (batch_id, position);
alter table public.document_batch_items enable row level security;
