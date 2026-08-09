# Free vs Pro restructure — Salary Negotiation & Resume A/B Tracker

Date: 2026-08-09. Branch: `claude/markdown-file-response-y8qolt`.

**Philosophy applied:** Free = the full basic utility competitors give away. Pro = intelligence and outcomes (live data, analytics, optimization) — never just "more uses."

## Salary Negotiation Script

**Now FREE + unlimited, no account required.** Input current salary / offer / target → a custom counter-offer script, talking points, and a defensible number, in a professional tone.

**Pro upsell (intelligence, not limits):**
- **Live market data** — a real median for the role in the city (`market_data` flag; pulled from live listings when `RAPIDAPI_KEY` is set).
- **3 email templates** — initial counter, follow-up, final push (`email_templates` flag).
- **Risk meter** — deterministic: "This ask is 15% above market — moderate risk."

Badge: **FREE · No limits**. Pro CTA: **"See market data for your role."** Paywall copy pitches the data + templates, never "unlimited."

## Resume A/B Test Tracker

**Free: save up to 3 versions** (was 2), name them, **tag each to a job posting** (new field), and see the raw counts side by side.

**Pro upsell:**
- **Response-rate analytics** per version + the current winner (`response_analytics` flag). Free sees raw counts only.
- **AI diagnosis** — "Version A is missing 4 keywords from the job description" (`ai_diagnosis` flag), via a per-version JD box.
- **Auto-merge winning elements** + **unlimited versions** (surfaced as Pro benefits).

Badge: **3 VERSIONS FREE**. Pro CTA: **"Track which version gets responses" / "Get AI optimization tips."**

## What changed

| Area | Change |
|---|---|
| `tools-core.js` | `salaryNegotiation` → no free cap (unlimited); `resumeVersions.free` 2→3. Tier-aware `buildSalaryPrompt(…, pro)`, `emailTemplates` in `validateSalary`, new `computeRiskMeter`, `stripAnalytics`, `buildDiagnosisPrompt`/`validateDiagnosis`, `job_tag` in `summarizeVersions`, `PRO_FLAGS`. |
| `server.js` | Salary route: anonymous-allowed, unlimited, Pro-only market data + templates + risk meter. A/B: analytics stripped for free, `job_tag` column (`_ensureColumn` after table create), free cap 3, new Pro-only `POST /api/tools/resume-version/:id/diagnose`. |
| `public/tools/salary-negotiation.html` | FREE badge, no-account flow, Pro sections (market/risk/templates) with an upsell for free users. |
| `public/tools/resume-ab-tracker.html` | 3-VERSIONS-FREE badge, job-posting tag field, raw side-by-side for free, analytics + AI-diagnosis UI for Pro. |
| `public/index.html` | Salary card → FREE; new Resume A/B Tracker card (3 VERSIONS FREE); both grouped in the free-tools grid with Pro-intelligence CTAs. |
| `public/score.html` | Both tools added to the **Free Tools hub** (EN + ZH). |
| `public/pro-tools.html` | Both removed from the Pro hub (they're free-first now). |
| Paywall modals | Rewritten to pitch the Pro **intelligence** (market data, templates, analytics, AI tips), not "unlimited." |

## Tests

`test/tools.js` extended: `computeRiskMeter` bands, `emailTemplates`/free-shape validation, `buildSalaryPrompt` tier behavior, `buildDiagnosisPrompt`/`validateDiagnosis`, `job_tag` + `stripAnalytics`; routes now assert anonymous salary, the free 3-version cap, analytics gating (free `analytics:false`, no leader/rate; Pro `analytics:true` + leader), and the Pro-only diagnosis gates. **Full suite: 38 files green.**

## Note

The free Salary route is an unauthenticated LLM endpoint by design (per the "no account required" spec); it keeps the existing per-IP rate limiter (20/min) as the abuse guard. Live market data only appears when `RAPIDAPI_KEY` is configured — otherwise Pro shows the model's clearly-labeled estimate, and the risk meter compares against that.
