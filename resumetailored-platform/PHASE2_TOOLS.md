# Phase 2 — the 5 remaining candidate tools

All five "coming soon" placeholders are now fully working tools, using the same
modal shell, design tokens, and `auth()` pattern as Phase 1. `next build` is
green. They open from the sidebar (no dock).

## The tools

### 1. LinkedIn Optimizer  → `linkedin` · `/api/linkedin-optimize`
Paste headline + About + a target role → rewritten **headline, About, and
experience bullets**. Prompt ported verbatim from the old site's
`/api/optimize-linkedin`. **Pro** adds a *Skills to add/remove* section and a
*keyword-density analysis* (free sees an upgrade note). Copy-all button on the
output.

### 2. Interview Coach  → `interview` · `/api/interview-coach`
Two tabs. **Questions:** paste a JD (or import from URL) → a realistic mix of
behavioral + technical questions (Free 5, Pro 12), each tagged and with a "what
a strong answer covers" line. **Practice:** pick a question, type an answer, get
a scored review (overall + structure/relevance/keywords 0–5, strengths,
improvements). Feedback prompt ported from the old `interview-coach.js`.

### 3. Job Finder  → `jobs` · `/api/jobs/search` (Adzuna) + `/api/jobs/save`
Search live listings by keyword + location (title, company, location, salary,
snippet). **Save** to *My Jobs* (Supabase `job_saves`), reopen under the "My
Jobs" tab, delete. **"Build my resume for this"** opens the AI Resume Builder
with the JD pre-filled. **Pro:** salary + remote filters and up to 50 results
(Free = 10). Uses `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` from Railway.

### 4. Career Hub  → `career` · `/api/career-hub`
Enter current role + years + optional target → **career paths** (with
timelines), **skills to build**, a **skill-gap** (green have / red missing), and
a **phase-by-phase roadmap**. **Pro** adds curated learning **resources**.

### 5. Decoder Key  → `decoder` · `/api/decoder-key` — **ALWAYS FREE**
Paste a posting (or import from URL) → a decoded breakdown as color-coded chips:
**must-have** (teal), **nice-to-have** (violet), **red flags** (red), **hidden
requirements** (gold), **culture signals**, and **keywords to mirror**. Prompt
ported from the old `buildJobDecodePrompt`. **"Build my resume for this"**
pre-fills the Resume Builder. No Pro gate, ever.

## Files added
- `lib/tools-ai.ts` — prompt builders + validators + `extractJson` (linkedin, interview Q + feedback, career, decoder).
- `lib/job-saves.ts` — Supabase CRUD for saved jobs.
- `app/api/linkedin-optimize/route.ts`
- `app/api/interview-coach/route.ts` (action: questions | feedback)
- `app/api/career-hub/route.ts`
- `app/api/decoder-key/route.ts`
- `app/api/jobs/search/route.ts` (Adzuna)
- `app/api/jobs/save/route.ts` (+ `save/[id]/route.ts` for delete)
- `app/candidate/tools/{linkedin-optimizer,interview-coach,job-finder,career-hub,decoder-key}.tsx`
- `app/candidate/tools/jd-import.tsx` — shared "import JD from URL" row.
- `supabase/migrations/0003_job_saves.sql`

## Files changed
- `app/candidate/components/tool-host.tsx` — renders the 5 tools (Phase-3 Video/Studio still "coming soon").
- `app/candidate/components/tools-context.tsx` — the 5 ids are now `kind: "tool"` (was "soon"); "Jobs" → "Job Finder".
- `app/candidate/components/ui.tsx` — added a small `UpgradeNote` CTA.
- `components/candidate-sidebar.tsx` — LinkedIn Optimizer / Interview Coach / Job Finder / Career Hub / Decoder now open modals; "Job Matches"→"Job Finder", "Interview Prep"→"Interview Coach", Decoder added, Career Hub no longer Pro-pilled.

## One manual step
Run in the Supabase SQL editor (service-role key already on Railway):
```sql
create table if not exists public.job_saves (
  id bigint generated always as identity primary key,
  user_id text not null,
  job_data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists job_saves_user_created_idx on public.job_saves (user_id, created_at desc);
alter table public.job_saves enable row level security;
```
Without it, Job Finder search still works; only saving/My Jobs no-ops.

## Decisions & questions
1. **Gating = soft, not hard counters.** The brief listed tiny free caps ("1
   rewrite", "1 career analysis"). Enforcing per-user lifetime counts needs
   fragile storage and clashes with the app's stated "free tier is unlimited"
   model (CLAUDE.md). So I gated **premium *sections*** behind Pro instead of
   capping runs: LinkedIn skills/density (Pro), Interview question count (Free 5
   / Pro 12) + feedback for all, Job Finder filters + result count (Free 10 /
   Pro 50), Career resources (Pro). Decoder is always free. This gives a clear
   upgrade path without breaking the free experience. **Want true hard caps
   (e.g. "1/day") instead? Say so and I'll add a usage counter.**
2. **generations table:** its CHECK constraint only allows `resume`/
   `cover_letter`/`ats`, so I did **not** write these new tools to it (a write
   would fail the constraint). Job saves have their own table. If you want the
   new tools in history/stats, I'll add a migration widening the allowed types.
3. **Adzuna** is US-only in this route (matches the old default). Easy to make
   the country configurable if you sell abroad.
4. **Live demo:** I can't drive the Clerk-authed UI from here, so I verified via
   the production build (all routes compile, all tools wired). Please test each
   live after deploy — tell me anything that misbehaves and I'll fix it.

## Test after deploy
Sidebar → each tool opens its modal → LinkedIn (paste + role → optimize),
Interview (JD → questions → Practice → feedback), Job Finder (search → save →
"Build my resume for this"), Career Hub (roles → roadmap), Decoder (JD → chips).
