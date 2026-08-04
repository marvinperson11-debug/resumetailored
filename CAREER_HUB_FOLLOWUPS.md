# Career Hub — Follow-ups (answers to the 7 questions)

All seven decisions are implemented on branch **`claude/career-hub-followups`** (PR to follow). Full test suite green (20 files + expanded Career Hub coverage). Below is what shipped for each, and what you need to wire up operationally.

| # | Decision | Status | Notes |
|---|---|---|---|
| 1 | Chinese localization | ✅ plumbed | English-only today; translatable via `t()` in a follow-up, no rewrite |
| 2 | Cache pre-warming (top 20) | ✅ script | `npm run career:warm` — run nightly (needs cron) |
| 3 | GA events | ✅ live | 6 events fire through your existing `gtag` |
| 4 | Badge `noindex` | ✅ done | share assets, OG unfurls still work |
| 5 | Free-limit tuning | ✅ kept | plan defaults unchanged |
| 6 | "Score my answer" | ✅ done | Pro-only, **5/day**, free sees an upgrade nudge |
| 7 | Job alert emails | ✅ built | opt-in toggle + `npm run career:job-digest` (needs cron) |

---

## 1. Chinese localization — plumbed, additive later
User-facing strings now route through a `t(key, fallback)` helper (the app's `_t`, over `APP_I18N`). Missing keys fall back to the English literal, so **English works today with zero `zh` entries**, and a Chinese pass is purely additive: add `ch_*` keys to `APP_I18N.zh`. I wrapped the prominent labels/buttons/gating messages to establish the pattern; the follow-up is filling in translations, not restructuring. Did **not** block launch on this, as you asked. (Open sub-question for later: should quizzes/scenarios *generate* in the user's language? Easy to add — pass `lang` into the prompt builder + cache key.)

## 2. Cache pre-warming — `scripts/warm-career-cache.js`
Pre-generates quizzes + interview sets (behavioral & technical) + all scenario types for the **top 20 professions** (`CH.TOP_PROFESSIONS`: Registered Nurse, Software Engineer, Electrician, Project Manager, Accountant, …). Idempotent — skips anything already cached, so re-runs are cheap. Obscure roles stay lazy (generated on first real use) so no credits are burned on traffic that may never come.
**To activate:** `npm run career:warm` on a nightly cron (needs `ANTHROPIC_API_KEY`, `DATA_DIR`).

## 3. Google Analytics events
Six events fire through your existing `gtag` (G-JWC76X5X68): `quiz_start`, `quiz_complete` (with score+band), `badge_share`, `job_save`, `gap_analysis_run`, `interview_practice_start` (with kind). No new GA setup — they show up under Events in GA4.

## 4. Badge indexing — `noindex`
Every `/badge/:slug` page now carries `<meta name="robots" content="noindex">`. OG/Twitter tags are untouched, so LinkedIn/Twitter unfurls still render richly — they just won't compete with your real pages in Google.

## 5. Free-tier limits — unchanged
Kept exactly as the plan specced: Skills Lab 1 quiz + 1 retake/day, Job Finder 5 searches/day + 5 saved jobs, Gap 1/week, Scenario 1/week. Revisit after 30 days of real data.

## 6. "Score my answer" — Pro + 5/day, free upsell
- Pro-only **and** capped at 5 scorings/day (`CH.LIMITS.answerScore.pro`), enforced server-side against `usage_store` — it's the priciest per-call feature (Sonnet, uncacheable) and the strongest upsell.
- Free users now see the feature **locked with a nudge**: "🔒 Upgrade to Pro to get AI feedback on your answers" + an Upgrade button (previously the block was just hidden).

## 7. Job alert emails — `scripts/job-digest.js`
- **Opt-in** toggle in the Job Finder ("Email me a daily digest of new [Profession] jobs") → `check_ins.job_alerts`, via `GET`/`POST /api/jobs/alerts`.
- **Digest:** for each opted-in user with a saved profession, searches JSearch (cached per-profession so many subscribers to the same role cost one API call) and emails the top 5 via Resend. Subject: **"N new [Profession] jobs posted today."** Simple layout — title, company, location, link back to the feed.
- Pure email builder `CH.buildJobDigestEmail` is unit-tested (no send).
**To activate:** `npm run career:job-digest` on a daily cron (needs `RAPIDAPI_KEY`, `RESEND_API_KEY`, `DATA_DIR`).

---

## What you need to do operationally
1. **Two cron jobs on Railway** (or your scheduler of choice):
   - Nightly: `npm run career:warm`
   - Daily (morning): `npm run career:job-digest`
   *(Railway supports scheduled jobs; or an external cron hitting a small runner. Say the word and I'll add a Railway cron config or a guarded HTTP trigger endpoint.)*
2. Confirm **`RESEND_API_KEY`** is set for the digest emails (you already have Resend for password resets), and **`RAPIDAPI_KEY`** for the job search/digest.

## Tests
- `test/career-hub.js` — added: badge `noindex`, digest builder (subject/singular/escaping/link), `TOP_PROFESSIONS` validity, `answerScore` limit shape.
- `test/career-hub-routes.js` — added: score-my-answer 5/day Pro cap (pre-spent quota, no LLM call), job-alerts toggle lifecycle.
- Full suite: **20 files green.**

*Reply with which operational bits you want me to wire (Railway cron config / trigger endpoint), or the localization depth (UI only vs. generate-in-language), and I'll pick it up.*
