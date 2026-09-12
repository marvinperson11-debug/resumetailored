# Features A–E — build notes

All five features in one PR, enhancing existing tools (no new tools added).
`next build` → **✓ Compiled successfully**, lint + types clean.

## ⚠️ Deployment checklist
1. **Run the migration** `supabase/migrations/0014_job_board_and_site_views.sql`
   in Supabase. It:
   - adds `job_postings.public_listed boolean default false` (+ index) — the
     public job-board toggle (Feature E), and
   - adds `personal_sites.views integer default 0` — the site view counter (A4).
   Until it's run, the new bits degrade gracefully (jobs won't list publicly;
   view counts stay 0) and nothing else breaks.
2. Merge the PR → Railway auto-deploys `main`.
3. **Optional env:** `RESEND_API_KEY` (+ `RESEND_FROM`) turns on the employer
   email notification when someone applies via the public board. Without it,
   applications still save to the Candidates dashboard (email is skipped).
4. No other env changes. `/jobs` and `/jobs/[id]` are public (no auth).

---

## A) Personal Website (Web Studio) enhancements
All in `lib/site-templates.ts` (pure generator) + `personal-website.tsx` (builder)
+ `site-store.ts`.

- **8 templates** — added **Executive** (dark, gold-accent, premium), **Developer**
  (terminal chrome, monospace, code-block sections), **Designer** (2-col visual
  grid of cards), **Startup** (centered, bold, metric-style cards) alongside the
  existing Portfolio/Resume/Creative/Minimal. Each has distinct layout + palette,
  not just colour swaps, with matching builder thumbnails.
- **Background patterns** — Solid / Subtle dots / Subtle lines / Gradient mesh,
  as pure CSS on the page.
- **Section reorder + show/hide** — the Sections panel now has an eye toggle
  (show/hide) and ▲▼ reorder; order + visibility flow into the generated page.
- **Custom CSS** — an Advanced textarea appended verbatim to the page's `<style>`
  (with `</style>` stripped so it can't break out).
- **Favicon upload** — small image → `<link rel="icon">` in the published page.
- **Google Fonts** — pick any of a curated safe-list for heading/body; the
  generator injects the `fonts.googleapis.com` `<link>` and applies the family.
- **Animation toggle** — off by default; when on, sections fade-in on scroll via
  a tiny inline IntersectionObserver (no library).
- **Responsive** — every template keeps the existing mobile rules; new ones use
  responsive grids that collapse to one column.
- **Publish enhancements**
  - **Custom slug** — edit your `/site/<slug>` in Advanced; honored when valid and
    not taken (reserved names + collisions fall back to a random suffix).
  - **SEO fields** — custom page title, meta description, and OG image URL
    override the derived defaults in the page `<head>`.
  - **Analytics** — `personal_sites.views` increments on each public visit
    (`/site/<slug>` route, best-effort) and shows as "Views: N" in the builder.

## B) LinkedIn profile import
- **`lib/linkedin-import.ts`** (pure): CSV parser + JSON parser →
  `{ name, headline, location, summary, experience[], education[], skills[] }`,
  plus `toResumeText()` to seed the builder.
- **`POST /api/linkedin/import`** — accepts `{ linkedinJson }` or `{ linkedinZip }`
  (base64). Unpacks the export ZIP with Node's `zlib.inflateRawSync` and reads
  Profile/Positions/Education/Skills.csv. **No AI** — pure parsing.
- **Shared modal** `linkedin-import-modal.tsx` — upload ZIP/JSON or paste JSON,
  preview what was found, then apply. Wired into:
  - **Resume builder** — "LinkedIn" button next to Upload; fills the resume text.
  - **Profile page** — "Import from LinkedIn"; fills name/location/bio.

## C) One-click Apply Package (Job Finder)
The route (`/api/jobs/apply-package`) + the Pro-gated button + the 3-document
view (tailored resume, cover letter, LinkedIn message) already existed. Added:
- **Download** on each document, and **Download all (.zip)** via a new
  zero-dependency client ZIP helper (`lib/zip.ts`).
- Free users still hit the lock → upgrade modal; Pro generates the package.

## D) Color theme picker (AI Resume Builder)
- A **Theme colour** row: 8 presets (Navy/Violet/Teal/Gold/Rose/Emerald/Slate/
  Coral) + a native custom colour input + a "Default" reset.
- Stored on the draft (`accentColor` on `ResumeDraftContent` → Supabase) and
  threaded into the live preview, **PDF**, and **DOCX** so exports match. When set,
  it overrides the template's whole palette (headers, accent lines, skill pills,
  borders); the light tint is derived from it (`lightenHex`).

## E) Public job board
- **`/jobs`** (public, SSR) — all active + public-listed postings across employers,
  with company names, a GET-form search (keywords/location/type/remote/salary),
  and job cards.
- **`/jobs/[jobId]`** (public, SSR) — full posting + an **apply form** (name, email,
  phone, resume upload, cover letter, portfolio).
- **`POST /api/public/jobs/[jobId]/apply`** (no auth) — parses the uploaded resume
  (pdf/docx/txt), saves the applicant to the employer's pipeline as **"new"**,
  auto-computes a **local match score** vs the posting (no AI cost), and
  best-effort emails the employer (Resend).
- **Employer control** — the job editor has a "**List on the public job board**"
  toggle (default off); only Active + listed jobs appear on `/jobs`. Applicants
  land in the existing Candidates dashboard with their match score.

Design: public pages use the brand's dark navy/violet aesthetic, kept clean and
readable for anonymous visitors, with a light "For employers" link back to the app.

---

## Files

**New**
- `lib/zip.ts`, `lib/linkedin-import.ts`
- `app/api/linkedin/import/route.ts`
- `app/candidate/components/linkedin-import-modal.tsx`
- `app/jobs/page.tsx`, `app/jobs/[jobId]/page.tsx`, `app/jobs/[jobId]/apply-form.tsx`
- `app/api/public/jobs/[jobId]/apply/route.ts`
- `supabase/migrations/0014_job_board_and_site_views.sql`

**Edited**
- `lib/draft-types.ts` (+`accentColor`), `lib/resume-templates.ts` (accent override +
  `lightenHex`), `lib/pdf.ts` + `lib/docx.ts` (accent), `app/candidate/tools/doc-preview.tsx`
- `app/candidate/tools/resume-tailor.tsx` (theme picker + LinkedIn import)
- `app/candidate/tools/job-finder.tsx` (package downloads + zip)
- `app/candidate/profile/profile-client.tsx` (LinkedIn import)
- `lib/site-templates.ts` (4 templates, patterns, fonts, favicon, CSS, animation, SEO)
- `lib/site-store.ts` (custom slug + view counter), `app/site/[slug]/route.ts` (view++)
- `app/api/personal-website/{publish,mine}/route.ts`
- `app/candidate/tools/personal-website.tsx` (all A controls)
- `lib/employer-ai.ts` + `lib/employer-store.ts` (public listing/apply, `publicListed`)
- `app/api/employer/jobs/route.ts` + `[id]/route.ts`, `app/employer/jobs/jobs-client.tsx` (toggle)

## Notes / decisions
- **Apply-package route** kept its existing `{ resume, jobDescription }` shape (it
  already worked) rather than switching to the spec's `{ jobId, ... }` — the UI
  passes the selected job's description, so behavior matches the spec.
- **Match score on public apply** uses the deterministic local scorer (no AI
  cost/keys needed for anonymous traffic); employers can re-score with AI in the
  dashboard.
- **Custom CSS** is appended to the published page; it's the author's own page, but
  `</style>` is stripped to prevent markup break-out.
- Published sites store pre-rendered HTML, so template/customization changes apply
  on the next **Publish/Update** (same as before).
