# Career Site Builder — image upload for logo + banner

**PR #488** (merged) · **Deployed** to `app.resumetailored.com` (Railway deploy `43f25a12`, commit `e22ecd0`, status SUCCESS).

Employers can now **upload** a logo/banner image **or** paste a URL. Uploads go to a public Supabase Storage bucket and return a URL; the existing `career_sites.logo_url` / `banner_url` TEXT columns stay the storage mechanism — **no schema change**.

---

## ⚠️ One manual step — re-run migration 0016 in Supabase (idempotent)
The migration now also provisions the storage bucket + policies:
```sql
insert into storage.buckets (id, name, public)
values ('career-site-assets','career-site-assets', true) on conflict (id) do nothing;
```
plus three `storage.objects` policies — `career_assets_insert` / `_update` / `_delete` (each `drop policy if exists` first) — confining each employer to their own `{clerkUserId}/` folder via `(storage.foldername(name))[1] = auth.uid()::text`. Until you re-run it, uploads will fail (the builder shows a readable error); the URL option keeps working.

The bucket is **public** (public career-page assets). The server uploads with the service-role key (bypasses RLS); the policies are defense-in-depth for direct client access.

## Backend
- **`lib/career-site-store.ts`** — `uploadCareerAsset` (path `{employerId}/{timestamp}-{sanitized}.{ext}`, 1-year cache), `deleteCareerAsset` (only within the caller's folder), `assetPathFromUrl`. Type/size limits exported (`ALLOWED_IMAGE_TYPES`, `MAX_ASSET_BYTES` = 2 MB).
- **`app/api/employer/career-site/upload`**
  - `POST` — multipart `file`. Validates **jpeg/png/webp** and **≤ 2 MB**, rejects anything else with a readable 400. Returns the public `{ url }`.
  - `DELETE` — removes an asset, only if its path is inside the caller's own folder. Body `{ path }` or `{ url }`.
  - Both gated by `requireEmployerId`.

## Frontend (builder)
- Logo and Banner each gain an **[Upload | URL]** toggle.
  - **Upload**: file picker (`png/jpeg/webp`), **live thumbnail preview**, client-side type/size validation with a readable message. The upload is **deferred until Save** (Save uploads the file, then persists the returned URL).
  - **URL**: the existing text input, unchanged (the "advanced" option).
  - Helper tips ("square PNG under 1 MB for logos", "wide banner ≥ 1200px wide") + a subtle "Uploaded images are served from our CDN" note. Both options first-class — no warnings against uploads.
- The live preview reflects a freshly-picked file immediately (via an object URL) before it's uploaded.
- Public page fallbacks unchanged: no banner → gradient; no logo → first-letter badge + company name — **never a broken-image icon** when nothing is set.

## Constraints honored
- **No new dependencies** (native `fetch` + `FormData`; no dropzone lib). Reuses `requireEmployerId`. All SQL idempotent.
- `tsc --noEmit` ✅ · `next lint --max-warnings=0` ✅ · `next build` ✅ (upload route compiles) · Railway deploy **SUCCESS**.

## Verify (needs your Supabase/Clerk access)
1. Re-run `0016` in Supabase.
2. Employer portal → **Career Site** → for Logo and Banner, switch to **Upload**, pick images → **Save**.
3. Open `/careers/[slug]` (logged out) → the logo + banner render from Storage.
4. Confirm the **URL** tab still works, and that an **oversized (>2 MB)** or **non-image** file is rejected with a readable message (client-side immediately, and server-side as a 400 backstop).

## Notes / possible follow-ups
- Old uploads aren't auto-deleted when you replace an image (a new object is written and the DB points at it; the old file just lingers). The `DELETE` endpoint exists to clean these up — I can wire "replace deletes the previous file" if you want zero orphans.
- Bucket is public with no size quota beyond the per-file 2 MB cap; add a per-employer storage cap later if abuse becomes a concern.

## Unrelated, still open
- **#481** email notifications — draft, awaiting your merge after testing.
- Pre-existing `test` (homepage-nav) failure on `main` — unrelated; fixable in its own small PR anytime.
- Phase 1B remaining: **Video Interviews** + **DocuSign**.
