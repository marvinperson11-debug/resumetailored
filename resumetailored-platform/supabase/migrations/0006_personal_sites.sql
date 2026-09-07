-- Personal Website (Web Studio) published sites. One published site per user
-- (upsert on user_id), served publicly at /site/<slug>. `html` is the fully
-- rendered static page. RLS on; the server reads/writes with the service-role
-- key. The public /site/<slug> route reads by slug via the same server client.
create table if not exists public.personal_sites (
  slug        text        primary key,
  user_id     text        not null unique,
  html        text        not null,
  data        jsonb       not null default '{}'::jsonb,
  published   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists personal_sites_user_idx on public.personal_sites (user_id);
alter table public.personal_sites enable row level security;
