# Job Finder — Phase 2 build

The Job Finder is now the full spec'd tool: résumé-aware search with filters, match-scored listings + blur gate, a saved-jobs tracker with a status pipeline, a job detail view with match analysis, Pro cover-letter / apply-package generation, and salary insights. `next build` is green.

## Three decisions worth knowing (details at the bottom)
1. **Listings are real, not mock.** The app already has a **live Adzuna** integration (keys in prod), which beats AI-invented jobs. I kept Adzuna as the primary source and made the spec's **AI-generated listings the automatic fallback** when Adzuna is unconfigured or returns nothing — so the tool always shows results.
2. **Tracker extends the existing `job_saves` table**, not a new `saved_jobs` table — existing saves aren't lost. A small `ALTER` migration adds the status pipeline + notes.
3. **Match scores are computed locally** (résumé ↔ job keyword overlap) — instant and no per-listing LLM cost. Only the Pro cover-letter / apply-package call Claude.

## Pro gate (opens for all; paid features gated)
- **Sidebar** — "Job Finder" keeps opening for everyone, now with a **PRO** badge.
- **Free** — sees **5 matched jobs** (rest → a blurred "Upgrade to see all matches" card), can **save** jobs and use the **basic tracker** (status pipeline is free). Cover letter / apply package → upgrade.
- **Pro** — all matches, salary filter, **AI cover letter** per job, **one-click apply package** (tailored resume + cover letter + LinkedIn message), and **salary insights**.
- **Server** — `/search` returns 5 to free (+ `total`, `lockedCount`); `/cover-letter` and `/apply-package` return **402** for non-Pro.

## Left column
- **Search card:** résumé textarea + **My Resumes** picker, keywords, location, **experience level** (Any/Entry/Mid/Senior/Executive), **job type** multi-select chips (Full-time/Contract/Part-time/Internship/Remote), **Find matches**.
- **Matched list:** cards with company initial "logo", title, location + **Remote** badge, posted date, salary, a **match-score %** chip (color-coded), and a **save star**. **Sort** by Best match / Newest / Salary. Free **blur gate** after 5.
- **My Jobs tab:** saved jobs with a **status badge** + a status dropdown (Saved → Applied → Interview → Offer → Rejected), **View**, **Apply**, **Remove**.

## Right column (job detail)
- Title, company, location/type/level/posted, salary.
- **Match analysis:** green ✓ keywords you have, red ✗ keywords you're missing, and a "add these to raise your match" tip.
- Full **job description** + requirements.
- **Salary insights (Pro, collapsible):** role range + median for the result set, **your estimated value** positioned by match score, a two-bar comparison, and an honest "estimated, not a guarantee" note.
- **Sticky action bar:** Save · **Cover letter** (Pro) · **Apply package** (Pro) · **Mark applied** (free → moves to tracker) · **Apply on site** (external link). Generated outputs render inline with one-click Copy.

## Routes / data
- `POST /api/jobs/search` → `{ jobs[], total, lockedCount, pro, source }` (Adzuna → AI fallback; résumé-scored).
- `GET /api/jobs/save`, `POST /api/jobs/save`, `DELETE /api/jobs/save/[id]` (existing) — now return/carry status.
- `PATCH /api/jobs/status` → update a saved job's pipeline status.
- `POST /api/jobs/cover-letter` (Pro), `POST /api/jobs/apply-package` (Pro).
- `supabase/migrations/0009_job_saves_status.sql` — **run it in Supabase** to enable the status pipeline (the store falls back gracefully to a plain saved list until you do).

## Files
**Added:** `lib/jobs-ai.ts`, `app/api/jobs/{status,cover-letter,apply-package}/route.ts`, `supabase/migrations/0009_job_saves_status.sql`.
**Changed:** `app/api/jobs/search/route.ts` (résumé-aware + match + AI fallback), `lib/job-saves.ts` (status/notes + updateJobStatus), `app/candidate/tools/job-finder.tsx` (full rewrite), `components/candidate-sidebar.tsx` (PRO badge).

## Verify after deploy
Sign in → Job Finder → paste résumé + keywords + location → pick level/type → **Find matches** → cards show match %; click one → match analysis + description on the right. **Free:** 5 + blur; cover/package → upgrade. **Pro:** all matches → **Cover letter** / **Apply package** → copy outputs; open **Salary insights**; **Save** / **Mark applied** → **My Jobs** tab → change status.

---

## The three decisions in full (your call if you want any changed)

1. **Adzuna vs AI mock listings.** The spec said "since we don't have a live job API yet, AI-generate listings." We **do** have one (Adzuna, live, keys set), so I kept it as the real source and used AI listings only as the fallback. If you'd rather force AI-generated listings always (e.g. for consistent demos), I can flip the order — one line.
2. **`job_saves` vs new `saved_jobs` table.** The spec's SQL creates a fresh `saved_jobs` table, but the app already stores saves in `job_saves` (live, with rows). Creating a second table would strand existing saves, so I **extended `job_saves`** with `status`/`notes`/`updated_at` via `ALTER ... IF NOT EXISTS` (safe, non-destructive). If you specifically want the `saved_jobs` name/shape, say so and I'll write a data-migrating switch.
3. **Migration `0009` is required for the pipeline.** Until you run it, saving/removing still works and everything shows as "saved"; status changes just won't persist. `lib/job-saves.ts` detects the missing columns and degrades gracefully rather than erroring.
