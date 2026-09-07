# Candidate dashboard — UI fixes + AI Resume Builder enhancements

Branch: `claude/candidate-dashboard-tool-dock-c4k29d` · built in the Next.js app
(`resumetailored-platform/`). `next build` is green (all routes + type-check;
one non-fatal font lint warning is suppressed). All 104 templates re-verified to
render with the new photo/signature/font options (104 OK / 0 fail), screen +
print.

---

## Every change

### Naming (competitor avoidance) + FIX 6
- Sidebar hero item **"Tailor My Resume" → "Build My Resume"**.
- Resume tool header **"Resume Tailor" → "AI Resume Builder"** (modal title).
- Primary button **"Tailor My Resume" → "Build My Resume"**, **"Re-tailor" → "Rebuild"**.
- Dashboard quick action **"Tailor Resume" → "Build My Resume"**.
- Sidebar brand **"Resume Tailored" → "ResumeTailored"** (candidate + employer sidebars).
- Upgrade modal copy **"unlimited tailoring" → "unlimited resume building"**.
- Catch-all label `tailor:` → **"AI Resume Builder"**.
- Left in place (not user-facing): internal function names, the `/api/tailor`
  route path, and the AI prompt text (the model instruction "tailor the resume"),
  and the brand string "ResumeTailored"/"resumetailored.com".

### FIX 1 — removed "Start with Resume Tailor" button
Removed from the dashboard home. Quick actions + stat cards remain.

### FIX 2 — removed the bottom tool dock
`tool-dock.tsx` deleted and unmounted from the candidate layout. Navigation is
sidebar-only now.

### FIX 3 — sidebar opens the tools
"Build My Resume", "Cover Letters", and "ATS Scanner" now open their tool modals
directly (via the tools context) instead of navigating to placeholder pages.
"My Resumes" links to the new real page. Everything else still navigates.

### FIX 4 — profile photo upload
The top-right avatar (`ProfileButton`, wrapping Clerk's `<UserButton>`) gains an
**"Upload photo"** menu action → file picker → `user.setProfileImage({ file })`,
which persists the photo on the Clerk user record and updates the avatar.

### FIX 5 — removed the greeting
"Good morning, {name}" is gone. Stat cards + quick actions only.

### FIX 7 — AI Resume Builder enhancements
1. **Photo upload** — downscaled client-side (≤400px JPEG) and rendered into the
   template header (sidebar avatar, Modern/Banner header, TwoCol left column,
   linear headshot) **and the PDF**.
2. **Signature** — a typed signature rendered as a sign-off block (in the chosen
   font) on the resume and, for cover letters, as a "Sincerely," close — in
   preview **and PDF**.
3. **Body font selector** — Arial, Times New Roman, Calibri, Georgia, Helvetica,
   Garamond, Cambria.
4. **Signature font selector** — the body fonts plus cursive **Dancing Script**
   and **Great Vibes** (loaded from Google Fonts in both the live preview and the
   PDF print window).
5. **Job posting URL import** — paste a LinkedIn/Indeed/Greenhouse/… URL → server
   scrapes it (`/api/fetch-job-url`, ported from the old site: JSON-LD → HTML
   strip → Claude extract, allowlisted domains, signed-in only).
6. **Auto-save** — the draft is saved to Supabase every 30s, on Build, and on
   close. No lost work on refresh.
7. **Version history** — see "My Resumes" below.
8. **Skills-gap highlight** — a "Skills gap" tab shows the job's top keywords as
   green (present in your resume) / red (missing) chips, computed locally before
   you build.

### FIX 8 — "My Resumes" is functional
`/candidate/resumes` lists every saved resume (job title + last-updated), newest
first, with **Reopen** (restores the full builder state), **PDF** (renders the
saved resume with its photo/signature/fonts), **Delete**, plus Refresh / Build new.

---

## New / changed files
- `lib/resume-templates.ts` — photo + signature rendering, expanded `FONT_MAP`,
  new `SIG_FONT_MAP`, `BODY_FONTS`, `SIG_FONTS`, extended `RenderOptions`.
- `lib/pdf.ts` — threads photo/signature/fonts; loads cursive faces in the print window.
- `lib/skills-gap.ts` — pure keyword gap analyzer (new).
- `lib/draft-types.ts` — shared, dependency-free draft DTOs (new).
- `lib/resume-drafts.ts` — Supabase CRUD for saved resumes (new, server-only).
- `app/api/fetch-job-url/route.ts` — job URL scraper (new).
- `app/api/resumes/route.ts` (+ `[id]/route.ts`) — drafts list/upsert/delete (new).
- `app/candidate/resumes/page.tsx` + `my-resumes.tsx` — My Resumes page (new).
- `app/candidate/tools/resume-tailor.tsx` — rebuilt AI Resume Builder UI.
- `app/candidate/tools/doc-preview.tsx` — passes photo/signature/fonts.
- `app/candidate/components/{tools-context,dashboard-home,tool-host,ui}.tsx` — dock
  removal, draft reopen plumbing, greeting/button removal, `Select` control.
- `app/candidate/layout.tsx` — dock removed, cursive fonts linked.
- `components/{candidate-sidebar,dashboard-shell,profile-button}.tsx` — sidebar
  opens tools, top-bar photo upload.
- `supabase/migrations/0002_resume_drafts.sql` — new `resume_drafts` table.

---

## One manual step before this fully works live
Run the new migration in the Supabase SQL editor (the `SUPABASE_SERVICE_ROLE_KEY`
is already set on Railway):

```sql
-- supabase/migrations/0002_resume_drafts.sql
create table if not exists public.resume_drafts (
  id          text        not null,
  user_id     text        not null,
  title       text        not null default 'Untitled resume',
  content     jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists resume_drafts_user_updated_idx
  on public.resume_drafts (user_id, updated_at desc);
alter table public.resume_drafts enable row level security;
```

Without it, the builder still works fully — autosave/My Resumes just silently
no-op (empty list) instead of persisting.

---

## Notes / decisions (flag anything you want changed)
- **Signature = typed text in a chosen font**, not an uploaded ink image — that's
  what the "signature font selector" implies and it needs no second uploader. Say
  the word if you'd rather it accept a drawn/uploaded signature image too.
- **Photo placement** is per-layout (avatar slot where one exists, header/column
  otherwise). It renders on all 56 resume layouts; cover letters don't take a photo.
- **Autosave creates one draft row per builder session** (a fresh "Build My
  Resume" = a new saved resume; "Reopen" updates the same row). If you'd prefer an
  explicit "Save" button instead of / in addition to autosave, easy to add.
- **Job URL import** is limited to the same job-board allowlist as the old site
  (many boards block automated fetches / require login → the user is told to paste
  instead). It's signed-in only.
- ATS scan and cover letter tools are unchanged except the shared UI + naming.
