# TASK_SUMMARY — 7 New Job-Search Tools

Date: 2026-08-08. Branch: `claude/markdown-file-response-y8qolt`.

Adds seven tools across the Free Tools (`/score`) and Pro Tools (`/pro-tools`) hubs, with server-side gating, seven tool pages, entry points across the site, a Monday email job, and a full test suite. Built in one PR.

## The 7 tools

| # | Tool | Page | Gating | Model |
|---|------|------|--------|-------|
| 1 | Offer Comparison Calculator | `/tools/offer-comparison` | Free, anonymous | none (deterministic) |
| 2 | Job Description Decoder | `/tools/job-description-decoder` | 3/day free (sign-in) | Haiku |
| 3 | Follow-Up Email Generator | `/tools/follow-up-generator` | 5/month free (sign-in) | Haiku |
| 4 | AI Mock Interview | `/tools/mock-interview` | 1/month free (sign-in) | Haiku (questions) + Sonnet (feedback) |
| 5 | Salary Negotiation Script | `/tools/salary-negotiation` | 1/month free → Pro | Sonnet (+ live JSearch data when `RAPIDAPI_KEY` set) |
| 6 | Resume A/B Test Tracker | `/tools/resume-ab-tracker` | 2 versions free, unlimited Pro | none |
| 7 | Weekly Job Search Report | `/tools/weekly-report` | Pro only | none |

## Architecture

- **`tools-core.js`** — pure, dependency-free core (no DB, no network): the deterministic Offer Comparison scorer, the `LIMITS` table, all LLM prompt builders, JSON validators, the A/B version summarizer, and the weekly-report email builder. Unit-tested directly. Mirrors the `career-hub.js` pattern.
- **`server.js`** — three tables (`tool_usage`, `resume_versions`, `weekly_report_subscriptions`) and ten routes under `/api/tools/*`, all gated server-side. `toolGate()` enforces sign-in (`getSessionEmail`) + quota (`tool_usage` counted against a UTC day/month window); `isSubscriber()` lifts every cap. Generative routes use `callClaudeJSON` (JSON tools) or a direct `anthropic.messages.create` (the follow-up email). Salary market data comes from live JSearch only when `RAPIDAPI_KEY` is present, otherwise the model estimates and says so.
- **`public/tools/*.html`** (7 pages) — cream `#FAF7F0` / forest `#1F5C3D` theme matching the hubs, sharing **`public/tools-hub.css`** + **`public/tools-hub.js`** (auth via the app's `rt_token`, a bilingual EN/中文 toggle, the upgrade modal, copy/download). Both shared assets are added to the server's version-rewrite list so they're cache-busted like every other asset.
- **`scripts/weekly-report.js`** + **`career-cron.js`** — the Monday digest runs on the existing in-process scheduler (new `scheduleWeekly` helper, Monday 13:00 UTC, `WEEKLY_REPORT_HOUR_UTC` override), Pro-only, computing last-week stats from the `applications` tracker and sending via Resend. No new infrastructure. `npm run career:weekly-report` runs it standalone.

## Gating (server-side enforced)

- Sign-in required for JD Decoder, Follow-Up, Mock Interview, Salary Negotiation, A/B Tracker, Weekly Report. Offer Comparison is fully anonymous.
- Free limits are counted per `user_email` in `tool_usage`: day window (JD Decoder) or month window (Follow-Up, Mock Interview, Salary) resetting at 00:00 UTC / 1st of month. A/B Tracker caps free users at 2 rows. Weekly Report is Pro-only.
- On hitting a limit the API returns `402 { error:'quota', message }` and the page shows the upgrade modal with the green **Upgrade — $19.99/mo** button.

## Entry points added

- **`/score`** — 4 free cards (Offer Comparison featured first, then JD Decoder, Follow-Up, Mock Interview), with EN/中文 dictionary entries.
- **`/pro-tools`** — 3 Pro cards (Salary Negotiation featured with a "1 Free Use / Month" badge, A/B Tracker "2 Versions Free", Weekly Report "Pro"), with EN/中文 entries.
- **Homepage** — a "New tools to win your job search" section with 4 cards.
- **Dashboard (`app.html`)** — a "New Tools" sidebar button (NEW badge) opening a modal that lists all 7 tools with free/Pro status ("✓ Included in your Pro plan" for subscribers), plus an A/B Tracker banner shown under the tailor output.
- **Job Tracker** — Applied cards 7+ days old get a "✉️ Generate Follow-Up" button that deep-links to the generator prefilled with company/role/days.
- **Employer Portal** — a Salary Negotiation Script card in the dashboard for employers to share with candidates.

## Tests

`test/tools.js` — pure core (offer scoring incl. ratio-normalization + no-NaN edge cases, validators, version summary, weekly email, weekly cron timing) and HTTP route integration (boots the real app against a temp DB): offer comparison, every auth/validation/quota gate on the generative tools, A/B tracker CRUD + free cap, weekly-report Pro-only toggle, and page/asset serving. LLM routes are exercised only through their pre-LLM gates, so **no Anthropic/RapidAPI calls or budget are used**. All 31 suite files pass.

## Notes / decisions

- Offer Comparison uses ratio-of-max normalization (not min–max) so a small dollar gap doesn't zero out an offer's comp score — weights: total comp 0.6, commute 0.15, remote 0.15, PTO 0.1.
- Salary/JD ranges are AI-estimated with an explicit "estimate, not a guarantee" note unless live JSearch data is available.
- Everything bundles into the existing $19.99/mo Pro plan — no new tier.
