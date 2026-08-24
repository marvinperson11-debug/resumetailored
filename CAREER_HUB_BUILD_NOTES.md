# Career Hub — Build Notes & Open Questions

**Status:** Built and **merged to `main`** in PR #313 (squash). Full test suite green (20 existing files + 2 new). Nothing left blocking; the items below are verification steps and decisions for you.

---

## What shipped (all 7 phases)

| Phase | Endpoints | New tables / columns |
|---|---|---|
| 0 Foundation | `GET`/`POST /api/profession` | `check_ins` +`profession_id`,`profession_cat`,`seniority`,`profession_set_at`; `public/data/professions.json` (10 categories / 67 roles) |
| 1 Skills Lab | `/api/skills-lab/quiz`, `/submit`, `/attempts`, public `/badge/:slug` | `quiz_cache`, `skill_attempts`, `badges` |
| 2 Interview Prep | `/api/interview/questions`, `/progress`, `/score` (Pro) | `interview_cache`, `interview_progress` |
| 3 Gap Analyzer | `/api/skills-gap`, `/reports` | `gap_cache`, `gap_reports` |
| 4 Job Finder | `/api/jobs/search`, `/save`, `/saved`, `DELETE /saved/:id` | `job_cache`, `saved_jobs` |
| 5 Dashboard | `/api/career/dashboard`, `/coach` (Pro) | — (composes all) |
| 6 Scenario Lab | `/api/scenario-lab/scenario`, `/complete` | `scenario_cache`, `scenario_progress` |

**Files:** `career-hub.js` (pure core), `badge-page.js`, `public/data/professions.json`, `public/career-hub.js` + `.css`, `test/career-hub.js`, `test/career-hub-routes.js`; plus edits to `server.js`, `public/app.html` (2 lines), `.env.example`, `.gitignore`, `CLAUDE.md`.

**Gating (implemented exactly as you specified):** Skills Lab 1 quiz + 1 retake/day, Silver-capped (Gold = Pro) · Interview behavioral free, technical + "Score my answer" Pro · Job Finder 5 searches/day + 5 saved jobs · Gap 1/week · Scenario 1/week · coach summary Pro. All bundled into the existing $19.99 Pro — no new tier.

**Cost design:** cross-user caches keyed by `hash + PROMPT_VERSION` ⇒ each generated variant is a one-time cost, then free. Haiku for generation, Sonnet only for Gap Analyzer + answer scoring.

---

## How to verify live

1. Open `/dashboard` (app.html) → the six tools are under the **Career Hub** sidebar heading.
2. First open triggers the **profession picker**; pick a role → every tool tailors to it.
3. Take a quiz → score → badge → open the public `/badge/:slug` link.
4. Job Finder needs `RAPIDAPI_KEY` (see below); everything else runs on `ANTHROPIC_API_KEY` only.

---

## Things for you to check

- [ ] **`RAPIDAPI_KEY` on Railway** — must be set in the Railway dashboard (not just locally) for the Job Finder. If `/api/jobs/search` returns `jobs_unconfigured`, the var isn't reaching the container. Everything else works without it.
- [ ] **DB persistence** — the 11 new tables are created at boot via `CREATE TABLE IF NOT EXISTS`. If `DATA_DIR` isn't a mounted volume, they (and all user data) reset on each deploy — same caveat as the rest of the app.

---

## Open questions / decisions for you

1. **PR #312 (the plan PR)** — now superseded, since `CAREER_HUB_PLAN.md` rode along into `main` on the build branch. Close it? *(I won't touch it unless you say so.)*
2. **Chinese (中文) localization** — the Career Hub UI is currently **English-only**; it doesn't yet run through `APP_I18N`/`_t`. The rest of the app is bilingual. Want me to localize it, and should quizzes/scenarios generate in the user's language?
3. **Pre-warming the caches** — I did *not* add the optional overnight script to pre-generate the top-N professions, so the *first* user of each profession/topic waits for a live Haiku call (~1–2s). Want the warm-up script?
4. **Free-tier limits** — shipped exactly as specced. Want any dialed in after you watch real usage (e.g. quiz 1→2/day, gap 1/week→2)?
5. **GA events** — no analytics events wired into the new tools yet (quiz started/completed, badge shared, job saved, upgrade-clicked). Want me to add `gtag` events to match the rest of the app?
6. **Badge page indexing** — `/badge/:slug` is public and OG-tagged for sharing. It's currently indexable. Keep it indexable (SEO upside) or `noindex` it (privacy)?
7. **Scenario Lab entry point** — it's a sidebar tool. Do you also want it surfaced as a "recommended next step" card more aggressively on the Dashboard?

---

*Reply here or in chat with which of these you want, and I'll pick them up.*
