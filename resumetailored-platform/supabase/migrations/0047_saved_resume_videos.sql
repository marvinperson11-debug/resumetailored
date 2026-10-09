-- Saved Resume Videos: every rendered resume video is stored (MP4 + a TXT copy of the script) and listed
-- on the candidate dashboard next to "Resumes built". One row per video, scoped by Clerk user_id.
--
-- Access is server-side only: the app reads/writes with the service-role key after checking the owner, so RLS
-- is on with NO public policy (same as video_generations). The files live in a PRIVATE bucket under
-- {user_id}/{video id}.mp4 and {user_id}/{video id}.txt and are only ever handed out through owner-checked routes.
create table if not exists public.saved_resume_videos (
  id            uuid        primary key,
  user_id       text        not null,
  title         text        not null default 'Resume video',
  script        text        not null default '',
  -- 'ai' = generated from the personalization fields; 'written' = typed by the user.
  script_source text        not null default 'ai' check (script_source in ('ai', 'written')),
  -- true when the user changed an AI script by hand before this render.
  script_edited boolean     not null default false,
  to_whom       text        not null default '',
  opener        text        not null default '',
  closer        text        not null default '',
  template      text        not null default 'professional',
  resume_text   text        not null default '',
  -- voice, backgroundColor, headshot (+ position), everySlide — the Video settings this render used.
  settings      jsonb       not null default '{}'::jsonb,
  video_path    text        not null,
  script_path   text        not null,
  size_bytes    bigint      not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists saved_resume_videos_user_created_idx on public.saved_resume_videos (user_id, created_at desc);
alter table public.saved_resume_videos enable row level security;

-- Private bucket for the MP4s and script text files (service-role access only; no storage.objects policies).
insert into storage.buckets (id, name, public)
values ('resume-videos', 'resume-videos', false)
on conflict (id) do nothing;
