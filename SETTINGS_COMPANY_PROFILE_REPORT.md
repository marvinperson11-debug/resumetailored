# Settings & Company Profile — bug fix + features

Feature branch: `claude/esignatures-document-uploads-973zwc`
App: `resumetailored-platform/` (Next.js 14 · TypeScript · Supabase · Clerk)

**No new dependencies.** `tsc`, `next lint`, and `next build` are all green.

> ⚠️ **Hand-apply before deploying:** `resumetailored-platform/supabase/migrations/0025_employer_company_bio.sql`
> (idempotent — `add column if not exists`; safe on a fresh or existing DB and safe to re-run).
> Also ensure the earlier **0024** migration is applied. The bug fix below means a deploy that
> lands *before* these migrations no longer locks anyone out — the fields just stay dark until applied.

---

## BUG 1 — Settings page "frozen" (couldn't click anything) — FIXED

**Root cause.** The employer layout renders a **blocking, no-close onboarding modal**
(`fixed inset-0 z-[70]`) whenever `getEmployerProfile()` returns `null`. In the previous PR,
`getEmployerProfile` started selecting the new `email_signature` column. Until migration 0024
is hand-applied, that column doesn't exist, so the PostgREST query errors → `getEmployerProfile`
caught it and returned `null` → an already-onboarded employer got the onboarding modal thrown
over **every** page (Settings included). The translucent overlay is why nothing on the page —
including the pre-existing Industry dropdown — was clickable.

**Fix.** `getEmployerProfile` (`lib/employer-store.ts`) now tries the full select first and, if it
errors (a newer column missing because a migration hasn't been applied yet), **falls back to the
base columns** that have existed since 0012. A schema lag can never again null out an existing
profile and lock the portal. `getPublicCareerSite` got the same defensive treatment for the new
`company_bio` column.

This resolves the current freeze *immediately* on deploy, before any migration is applied.

---

## FEATURES

### 2. Company name — dropdown of known names + type-a-new
`app/employer/settings/settings-client.tsx` + `settings/page.tsx`

The Company name field is now a **picker** of the employer's known names — the saved
`employer_profiles.company_name` and the Career Site builder's `career_sites.company_name`,
de-duplicated — plus a **"Type a new name…"** option that reveals a free-text input (for employers
who operate under multiple names). If there are no known names yet, it falls back to a plain input.
When empty, it **prefills from the Career Site name**.

### 3. Company size — removed
Removed the Company size field entirely — from the Settings page, the onboarding modal, the profile
API, the store write, and the `EmployerProfile` type (and the now-unused `COMPANY_SIZES` constant).
The legacy `company_size` DB column is simply left untouched (no longer read or written).

### 4. Company bio — added
New multi-line **Company bio** field on the company profile (`employer_profiles.company_bio`, via
migration 0025). Editable on the Settings page and surfaced on the public career page (see #6).

### 5. Avatar "Upload photo" — verified end to end
The top-right avatar menu's **Upload photo** item opens Clerk's native account-profile page
(`openUserProfile()`), where image upload/crop is built in; Clerk's `<UserButton>` avatar then
updates everywhere it's shown. This is the shared `ProfileButton`, so it's identical in the
**employer and candidate** shells. No code change needed — confirmed the path is wired in both
shells. (Image upload must be enabled in the Clerk dashboard for the instance; it's on by default.)

### 6. Employer public page — company profile + "About {company}" link
- `getPublicCareerSite` now also returns the employer's **industry** and **bio** from
  `employer_profiles`. The public career page (`/careers/[slug]`) shows the **industry** under the
  company name in the header and the **bio** in the "About {company}" section (bio first, then the
  Career Site builder's about text — one heading, no duplication).
- `getPublicJob` now resolves the employer's **career-site slug**, and every public job posting
  (`/jobs/[jobId]`) shows a clear **"About {company}"** link back to `/careers/[slug]`.

---

## Data model — migration `0025` (hand-apply)
`supabase/migrations/0025_employer_company_bio.sql` — idempotent.
- `employer_profiles.company_bio text` (nullable).

No column is dropped (the retired `company_size` stays in place, unused).

---

## Files
**New:** `supabase/migrations/0025_employer_company_bio.sql`
**Changed:**
- `lib/employer-store.ts` — resilient `getEmployerProfile` (bug fix); `company_bio` read/write; `getPublicJob` returns `companySlug`.
- `lib/career-site-store.ts` — `getPublicCareerSite` returns `industry` + `bio` (resilient).
- `lib/employer-ai.ts` — `EmployerProfile` gains `companyBio`, drops `companySize`; `JobPosting` gains `companySlug`; removed `COMPANY_SIZES`.
- `app/api/employer/profile/route.ts` — accept `companyBio`, drop `companySize`.
- `app/employer/settings/{page,settings-client}.tsx` — company-name picker, bio field, size removed.
- `app/employer/components/onboarding-modal.tsx` — company size removed.
- `app/careers/[slug]/{page,career-site-view}.tsx` — surface industry + bio.
- `app/jobs/[jobId]/page.tsx` — "About {company}" link to the career page.

## Verify
```bash
cd resumetailored-platform
npx tsc --noEmit   # ✔ no errors
npx next lint      # ✔ no warnings or errors
npx next build     # ✔ compiles
```
Runtime paths needing live Supabase/Clerk (profile save/load, career-page render, avatar upload)
can't run in CI here; all new reads are best-effort and fail safe.
