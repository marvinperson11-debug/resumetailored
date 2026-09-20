-- Employee Hub - Built-in Training Library (SCHEMA ONLY).
--
-- A curated, read-only library of FREE workplace-training content sourced only
-- from US-government, public-domain channels (OSHA / NIOSH / CDC / DOL / FEMA /
-- CISA / FDA / USDA). Videos are EMBEDDED (never downloaded) from the agency
-- official YouTube channel; docs carry an authored public-domain summary plus
-- an attribution link to the official source page.
--
-- Unlike the per-employer tables in 0029, the library is shared platform content:
-- RLS is ENABLED but there are NO policies, so it is reachable only through the
-- server service-role key (the same read path the stores already use). Clients
-- never query it directly.
--
-- This migration also links a training_docs row back to the library item it was
-- created from (training_docs.library_item_id), so a library video renders as an
-- embedded watch step while acknowledgment / signature / quiz tracking is
-- unchanged and source-agnostic.
--
-- SEED LIVES IN APP CODE, NOT HERE. The 18 rows are defined in
-- lib/training-library-seed.ts and inserted (idempotently, upsert on source_url)
-- by the admin-only route GET /api/employer/seed-library?do=1. This file is
-- deliberately schema-only and contains ZERO string data, so it pastes and runs
-- cleanly through any SQL editor or statement splitter.
--
-- HAND-APPLIED: run this against the Supabase project, then open the seed URL
-- once. It is idempotent (create ... if not exists / add column if not exists)
-- and safe to re-run.

-- Library table.
create table if not exists public.training_library_items (
  id bigint generated always as identity primary key,
  category text not null,
  title text not null,
  kind text not null default 'doc',
  provider text not null,
  embed_url text,
  body_html text,
  source_url text not null,
  created_at timestamptz not null default now()
);
create index if not exists training_library_category_idx on public.training_library_items (category, title);
-- Natural key for the idempotent code seed (upsert on source_url).
create unique index if not exists training_library_source_url_key on public.training_library_items (source_url);

-- Service-role only: RLS on, no policies (mirrors platform-content access).
alter table public.training_library_items enable row level security;

-- Link training_docs -> library item.
alter table public.training_docs add column if not exists library_item_id bigint references public.training_library_items(id);
create index if not exists training_docs_library_idx on public.training_docs (library_item_id);
