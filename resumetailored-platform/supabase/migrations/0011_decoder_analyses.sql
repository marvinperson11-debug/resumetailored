-- Decoder Key analyses — history + the free 1-per-day rate limit (counted from
-- today's rows). Server writes with the service-role key; RLS on.
create table if not exists public.decoder_analyses (
  id              bigint generated always as identity primary key,
  user_id         text        not null,
  job_title       text,
  company         text,
  job_description text,
  depth           text        not null default 'basic',
  analysis        jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists decoder_analyses_user_created_idx on public.decoder_analyses (user_id, created_at desc);
alter table public.decoder_analyses enable row level security;
