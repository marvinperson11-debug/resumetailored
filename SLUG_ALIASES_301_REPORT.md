# Slug aliases — 301 redirects for renamed career & candidate sites

**Branch:** `claude/slug-aliases-301-redirects-l3flqg`
**PR:** [#525 (draft)](https://github.com/marvinperson11-debug/resumetailored/pull/525)
**Scope:** `resumetailored-platform/` (the Next.js + Supabase app — *not* the SQLite `server.js` app)

---

## Problem

Renaming a slug — an employer career site (`career_sites.slug`) or a candidate
personal site (`personal_sites.slug`) — killed the old URL (404). Shared links
and any SEO value on the old address were lost.

## Solution

Every rename now leaves a forwarding row in a new `slug_aliases` table. The old
subdomain and the old `/careers/:slug` / `/site/:slug` paths **permanently
(301) redirect** to the current slug. The old slug also stays reserved so nobody
else can re-claim it while the redirect lives.

---

## Changes by file

### 1. `supabase/migrations/0028_slug_aliases.sql` (new)

- New `public.slug_aliases`:
  - `id bigint generated always as identity primary key`
  - `slug text not null unique`
  - `target_type text not null check (target_type in ('career','site'))`
  - `target_id bigint not null`
  - `created_at timestamptz not null default now()`
  - Index `slug_aliases_target_idx` on `(target_type, target_id)`.
  - **RLS enabled, no policies.** In Supabase this is what actually enforces
    "read via service role only" — with RLS *off*, the anon key can read the
    table. Service-role bypasses RLS, so the app is unaffected. Matches every
    other table's convention in this repo.
- **`personal_sites` gets a stable id:**
  `alter table public.personal_sites add column if not exists id bigint generated always as identity;`
  plus a unique index. `career_sites` already had a bigint `id` (0016), but
  `personal_sites` was keyed only on its **mutable** `slug`. An alias must point
  at something that survives a rename, so it needs a stable id. `generated
  always as identity` backfills existing rows automatically.
- **Idempotent + hand-applied** (`create … if not exists`, `add column if not
  exists`), same convention as `0027_documents.sql`.

> ⚠️ **Action required:** run this migration against the Supabase project before
> deploying. It is safe to run on a fresh or existing DB and safe to re-run.

### 2. `lib/tenant-resolve.ts`

- `isSlugTaken()` now also returns `true` when the slug exists in
  `slug_aliases` → a renamed slug can't be re-claimed.
- `resolveAlias(label)` — given an old slug, looks up the alias, then reads the
  current row by `id` to return the **current** `{ type, slug }`. Returns `null`
  if it isn't an alias / the target is gone / the slug is unchanged. Fails soft.
- `recordSlugAlias(oldSlug, newSlug, targetType, targetId)` — inserts the
  forwarding row. Idempotent (upsert on the unique `slug`), best-effort (never
  throws — a rename must not fail because the alias write did), no-op when the
  slug is empty or unchanged.

### 3. `lib/career-site-store.ts` — `updateCareerSite()`

After a successful update, if `patch.slug` differs from the pre-update slug,
records `recordSlugAlias(oldSlug, newSlug, "career", existing.id)`.

### 4. `lib/site-store.ts` — `publishSite()`

Now selects `slug, id` for the existing row. After a successful upsert, if the
slug changed, records `recordSlugAlias(prevSlug, slug, "site", prevId)`. The
identity `id` is unchanged by a slug rename, so it's a stable redirect target.
(`saveSiteDraft` never changes the slug, so it needs no alias.)

### 5. `app/api/tenant-resolve/route.ts`

When no current tenant matches the label, it resolves the alias and returns
`{ type, slug, aliased: true }` (still `{ type: null }` for a truly unknown
label).

### 6. `middleware.ts`

- Shared `resolveLabel()` helper calls `/api/tenant-resolve` on the canonical
  app origin (no Worker loop).
- **Subdomain root** (`{oldslug}.resumetailored.com/`) that is an alias → `301`
  to `https://{currentslug}.resumetailored.com/` (path preserved as `/`).
- **Direct path hits** `/careers/{oldslug}` and `/site/{oldslug}` that are
  aliases → `301` to the current `/careers/{slug}` or `/site/{slug}`. A current
  slug is never an alias, so live pages are never touched.

### 7. Public pages — 404-path backstop

- `app/careers/[slug]/page.tsx` and `app/site/[slug]/route.ts`: when the current
  lookup misses, they also resolve the alias and permanently redirect. This is
  the optional "public pages may also redirect" layer; middleware remains the
  required, primary path. Zero overhead on live pages (only runs on a miss).

---

## How resolution works (end to end)

1. Rename `acme` → `acme-inc` → row `{ slug: 'acme', target_type: 'career', target_id: <career_sites.id> }`.
2. Visit `acme.resumetailored.com/` → middleware asks the resolver → no current
   tenant → alias found → `301` to `acme-inc.resumetailored.com/`.
3. Visit `/careers/acme` directly → `301` to `/careers/acme-inc`.
4. Someone tries to claim `acme` for a new site → `isSlugTaken('acme')` is
   `true` (alias present) → rejected.

---

## Verification

All run in `resumetailored-platform/`:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ pass (exit 0) |
| `npm run lint` (`next lint`) | ✅ No ESLint warnings or errors |
| `npm run build` (`next build`) | ✅ pass (middleware + all routes compiled) |

## Constraints met

- ✅ Idempotent, hand-applied migration (next free number `0028`).
- ✅ No new dependencies.
- ✅ `tsc` / lint / build green.
- ✅ 301 (permanent) redirects everywhere, path preserved.
