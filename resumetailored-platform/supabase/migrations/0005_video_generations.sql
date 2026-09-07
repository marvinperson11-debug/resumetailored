-- Resume Video generations. One row per generated video/script, scoped by
-- Clerk user_id. RLS on, no public policy (server uses the service-role key).
create table if not exists public.video_generations (
  id          bigint generated always as identity primary key,
  user_id     text        not null,
  title       text        not null default 'Untitled video',
  script      text,
  video_url   text,
  template    text,
  created_at  timestamptz not null default now()
);
create index if not exists video_generations_user_created_idx on public.video_generations (user_id, created_at desc);
alter table public.video_generations enable row level security;
