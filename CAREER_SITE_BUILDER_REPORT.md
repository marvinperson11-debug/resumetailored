# Career Site Builder (employer feature #11)

**PR #487** (merged) · **Deployed** to `app.resumetailored.com` (Railway deploy `f65d4e2b`, commit `04284c0`, status SUCCESS).

Employers now get a public, brand-customizable careers page at **`/careers/[slug]`** that auto-lists their active, public-listed jobs.

---

## ⚠️ One manual step before it works in prod
Migrations here are applied by hand. Re-run the updated migration in Supabase (it's idempotent — safe to re-run):
```
resumetailored-platform/supabase/migrations/0016_employer_messages_shortlists_interviews.sql
```
This adds the `career_sites` table + RLS policy. Until it's applied, the builder shows its "Could not load…" error and `/careers/[slug]` 404s (best-effort, no crash).

## What shipped

### Backend
- **`career_sites` table** (appended to `0016`): `employer_id TEXT` (Clerk id), unique `slug`, branding (`logo_url`, `banner_url`, `brand_color` default `#F59E0B`), content (`about/mission/values`), 5 section toggles, `benefits`/`testimonials` jsonb, `contact_email`, timestamps. RLS enabled + `career_sites_owner` policy (`employer_id = auth.uid()::text`). All `if not exists` / `drop policy if exists` — re-runnable.
- **`lib/career-site-store.ts`**
  - `getCareerSite(employerId, companyName)` — returns the row, **creating a default on first access** with a **unique slug** (`slugify(company)` → `employer_id` fallback → `-2/-3…` on conflict).
  - `updateCareerSite(employerId, patch)` — validated writes (hex color guard, length caps, benefit/testimonial sanitizers). Slug is stable after creation (keeps shared links working).
  - `getPublicCareerSite(slug)` — **no auth**; returns the config + that employer's **active + public-listed** jobs, mapped to **public-safe fields only** (id, title, department, location, remote/employment type, salary, description, requirements).
- **APIs**
  - `GET` / `PATCH /api/employer/career-site` (auth via `requireEmployerId`).
  - `GET /api/careers/[slug]` (public — middleware already leaves `/careers` + `/api/careers` unauthenticated).

### Frontend
- **`/employer/career-site`** — builder with a form (company, logo/banner URLs, brand-color picker + hex, about/mission/values, section toggles, benefits editor, testimonials editor, contact email), a **live preview** on the right (re-renders as you type, using your real active jobs), and a **public-URL bar** with Copy + Open.
- **`/careers/[slug]`** — SSR public page. **SEO meta**: `title = "{Company} Careers"`, `description` from the about text (+ OpenGraph/Twitter). Reuses a shared `CareerSiteView` (self-contained **light theme**, brand color applied via a `--brand` CSS variable). Sections render per toggles; **each job card links to `/jobs/:id`** — the existing public application flow. Always-on **"Powered by ResumeTailored"** footer. Mobile responsive.
- **Sidebar**: added **"Career Site"** to the employer nav (was only a placeholder before).

### Constraints honored
- **No new dependencies** — pure CSS (inline `<style>` in the view), lucide icons only (already present). All SQL idempotent.
- `tsc --noEmit` ✅ · `next lint --max-warnings=0` ✅ · `next build` ✅ (all 4 new routes compile) · Railway deploy **SUCCESS**.

## Verify (needs your Supabase/Clerk access)
1. Apply the updated `0016` in Supabase.
2. Employer portal → **Career Site** → fill in branding/content, toggle sections, add a benefit + testimonial → **Save changes**. The live preview should mirror it and the public-URL bar shows `…/careers/<slug>`.
3. Open that URL (incognito, logged out) → the page renders with your active jobs; **Apply** on a card routes to `/jobs/:id` and into the existing application flow.
4. Confirm only public-safe job fields appear (no internal notes/match scores).

## Design decisions / notes
- **Apply flow reuse:** job cards link to the existing `/jobs/[jobId]` public detail+apply page (which requires the job to be `active` + `public_listed` — same gate the store uses), rather than duplicating an apply form.
- **Slug is immutable after creation** so shared careers links never break; it's not exposed as an editable field in the builder. If you'd like an editable/custom slug (with conflict handling), that's a small follow-up.
- **"Meet the team"** toggle exists but there's no team-member data model yet, so it renders a friendly placeholder line. A real team editor (names/photos/bios) is a natural Phase-2 add — tell me if you want it.
- **White-label footer** always renders for now, per spec (Corporate-tier removal comes later).

## Unrelated, still open
- **#481** email notifications — draft, awaiting your merge after testing.
- Pre-existing `test` (homepage-nav) failure on `main` — unrelated; I can fix it in its own small PR anytime.
- Phase 1B still has **Video Interviews** + **DocuSign** ahead whenever you want them.
