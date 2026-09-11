# Career Hub — Phase 2 build

The Career Hub is now the full spec'd tool: a persistent career profile, goals with progress/status, a milestone timeline, an AI roadmap, skill-gap analysis, salary progression, a certification tracker, and an insights card. `next build` is green.

> **Please read the "Branch note" at the bottom** — this PR currently also contains the Job Finder work, because Job Finder's PR (#463) wasn't merged before this build started.

## Pro gate (opens for all; paid features gated)
- **Sidebar** — "Career Hub" opens for everyone, now with a **PRO** badge.
- **Free** — save a profile, **up to 3 goals** (with progress/status), basic **milestones + timeline**. AI roadmap / skill-gap / insights / salary / certs → upgrade.
- **Pro** — unlimited goals, **AI roadmap**, **skill-gap analysis** with learning resources, **salary progression**, **certification tracker**, and **AI insights** (on-track + monthly actions).
- **Server** — the goals route returns **402 `goal_limit`** for a 4th free goal; `/roadmap`, `/skill-gap`, `/insights` are **402** for non-Pro. Profile / goals / milestones CRUD is free.

## Left column
- **Career profile card:** current role, target role, years, industry dropdown → Save (persists).
- **Goals:** add form (title, category, priority, target date, notes) → cards with a category badge, priority dot, **countdown** ("Due in 45d"), a draggable **progress slider** (auto-sets status), a status dropdown, **Complete**, and delete. Free capped at 3 (then upgrade).
- **Milestones:** add form (type, title, date, impact) → a **vertical timeline** (colored dots + connecting line), delete per item.
- **AI career roadmap (Pro):** paste skills → Generate → numbered **stage cards** (timeframe, skills, actions) + estimated months + confidence.

## Right column
- **Career timeline viz:** a horizontal, scrollable timeline combining **past milestones** (solid, color-coded by type) and **future dated goals** (dashed violet).
- **Insights (Pro):** a **career-velocity ring** (computed locally, refined by AI) + an **on-track / behind** verdict with a target date + **top 3 actions this month**.
- **Skill gap (Pro):** "skills you have" vs. "skills you need" — missing skills ranked by importance with a learning resource, each with **+ Add to goals**.
- **Certification tracker (Pro):** certs pulled from the roadmap, each with **+ Goal** (collapsible).
- **Salary progression (Pro):** add year/amount rows → a **CSS bar chart** + a rough projected-at-target estimate (collapsible).

## Routes / data
- `GET /api/career` (profile + goals + milestones in one load).
- `POST /api/career/profile`; `POST /api/career/goals` (free 3-cap), `PATCH`/`DELETE /api/career/goals/[id]`; `POST /api/career/milestones`, `DELETE /api/career/milestones/[id]`.
- `POST /api/career/roadmap` · `/skill-gap` · `/insights` (all **Pro**).
- `supabase/migrations/0010_career_hub.sql` — the three spec tables (`career_goals`, `career_milestones`, `career_profiles`). **Run it in Supabase** — unlike the other tools this one has no live-API fallback, so goals/milestones/profile won't persist until this table set exists.

## Files
**Added:** `lib/career-ai.ts`, `lib/career-store.ts`, `app/api/career/**` (9 routes), `supabase/migrations/0010_career_hub.sql`.
**Changed:** `app/candidate/tools/career-hub.tsx` (full rewrite), `components/candidate-sidebar.tsx` (PRO badge). The old `/api/career-hub` route is left unused.

## Verify after deploy (once 0010 is run)
Career Hub → fill profile → Save → add a goal (drag progress, mark complete) → add a milestone (see the timeline) → **Pro:** paste skills → Generate roadmap; Analyze skill gap → Add-to-goals; Generate insights (velocity + actions); open Salary progression + Certification tracker.

---

## Notes & caveats

- **Salary progression is client-only.** The spec provided no salary table (only goals/milestones/profile), so salary rows live in component state and reset when the modal closes, and the "projected at target" figure is a rough **+25%** placeholder (labeled as an estimate). If you want it persisted + a real market-rate source, that's a small follow-up (a `career_salaries` table + an insights field).
- **Run migration `0010`.** This tool is fully DB-backed with no fallback, so it needs the tables to persist anything (it degrades to empty state without them, no errors).

## Branch note (important)

I build each tool on the shared branch and you've been merging each PR before the next. **Job Finder (PR #463) is still open/unmerged**, so to avoid destroying its commit I built Career Hub *on top of it* — this branch (and whatever PR it feeds) now contains **both Job Finder and Career Hub**. Two clean options:
1. **Merge #463 first** (ships Job Finder), then I'll rebase Career Hub onto main so its PR is Career-Hub-only; or
2. **Merge them together** — I retitle #463 to cover both, and one merge ships Job Finder + Career Hub.

Tell me which you'd prefer. Nothing is lost either way; I just don't want to surprise you with a double-scoped PR.
