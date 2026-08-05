# Employer Portal + Job Feed Aggregator — Build Plan

Branch **`claude/employer-portal-marketplace`**, off `main` (which already has Part 1).

## Part 1 status: already done

PR #323 (mobile contrast round 3) is **already merged into `main`** — squash commit `4756d92` — before this master prompt arrived. Nothing to redo. No new work needed for Part 1.

## Delivery order (matches Part 5)

This is a multi-week build compressed into iterative PRs. I'm shipping it as separate, testable phases rather than one giant PR, so each phase is independently reviewable and "test live"-able as you asked:

1. **Phase A — Employer Portal foundation** (this PR): Hire Mode on the existing account, employer profile, job posting CRUD, posted-jobs list, free (3 posts) vs Pro Employer ($29/mo) gating, Stripe checkout wired to a new `employer_subscribers` table.
2. **Phase B** — Candidate database opt-in, ATS kanban, applications, reject email, rating/notes, candidate search, contact-request flow.
3. **Phase C** — Job Feed Aggregator: `job_feed` table, dedup, employer jobs get priority placement, 6h background refresh, "Jobs for You", save/bookmark, digest email update.
4. **Phase D** — Temp/gig/staffing layer.
5. **Phase E** — AI job matching digest (bonus, if time allows).
6. **Part 4** — job-seeker free/Pro gating updates.

Each phase = its own PR against this branch's successor (or stacked), pushed as ready, non-draft so Netlify builds a preview, held for your explicit merge — same pattern as the last three mobile rounds.

## Decisions made without asking (consistent with existing patterns, flagging so you can redirect)

- **Auth model:** "same account with Hire Mode toggle," not a separate employer login. Reuses the existing `users`/`sessions`/`rt_token` auth exactly as Part 3 asks ("reuse existing auth"). Any signed-in user can set up an employer profile and post jobs; nothing new to remember.
- **New page, not a new app.html tab:** `/employer` is its own page (`public/employer.html`), reusing the `rt_token`/`rt_email` from `localStorage` set by the existing login flow. app.html is already ~10,000 lines per its own doc comment; an employer dashboard (job form, kanban, candidate search) is a different enough surface that bolting it on as another tab would bloat an already-large single-page app for a feature most users never open.
- **Stripe:** separate `employer_subscribers` table (not a `type` column on `subscribers`), so the existing job-seeker webhook/`isSubscriber()` path is untouched — zero risk of a $19.99 subscriber accidentally reading as a $29 employer or vice versa. New env var `STRIPE_EMPLOYER_PRICE_ID`, same self-serve pattern as the existing optional `STRIPE_LIFETIME_PRICE_ID` — **you'll need to create that Price in the Stripe dashboard and set the env var**; the code fails gracefully (503, like the lifetime plan does today) until it's set.
- **"Schedule Interview"** ships as a **placeholder note field** (interview time/link the employer types in, emailed to the candidate) — not a real calendar integration. The prompt says "calendar link placeholder," which I'm reading literally; wiring a real Calendly/Google Calendar integration would need OAuth + an API key that don't exist yet. Say the word if you actually want a real calendar integration and I'll scope it separately.
- **Job Feed Aggregator sources — reality check:** JSearch (already live via `RAPIDAPI_KEY`) and Employer Portal jobs (live once Phase A ships) are real, working sources. **Indeed does not offer a public RSS/API feed for third-party aggregation** (they shut that down years ago to stop scraping — a publisher-affiliate API exists but needs a business approval process, not a signup-and-go key), and **ZipRecruiter's job search API is also partner-gated**, not an open free tier. Rather than fake these or block the whole feature on partner applications that could take weeks, I'm building the aggregator with a **pluggable source-adapter architecture**: each source is an adapter behind a feature flag/env var, fails open exactly like `RAPIDAPI_KEY` does today (missing key ⇒ that source is silently skipped, not an error), so JSearch + Employer jobs work immediately and Indeed/ZipRecruiter/company-RSS adapters can be dropped in later the moment you have real credentials — no code changes needed at that point, just an env var. I'll flag this again when Phase C ships.
- **Company career-page RSS**: genuinely open (any public RSS URL), so this one *is* buildable now — I'll let an employer or admin register a source URL and the aggregator polls it, same dedup path as everything else.

## Not yet decided / will revisit if it turns out to matter

- Candidate "assessment scores" the prompt wants searchable — reading this as the existing Skills Lab badge tier (Gold/Silver/Bronze) + quiz score already stored in `badges`/`skill_attempts`, not a new assessment type.
- "Open to Work" badge visibility tiering (Part 4: "limited exposure" on free) — will define as free = visible in search but ranked after Pro-visible candidates, Pro = full visibility, unless you'd rather it work differently.

---
*Questions or course-corrections — reply here or just tell me and I'll adjust before the next phase.*
