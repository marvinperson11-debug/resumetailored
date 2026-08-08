> **✅ RESOLVED & BUILT (2026-08-08).** All six questions were answered: build all 7 now; Haiku for JD Decoder / Follow-Up / Mock questions, Sonnet for Salary + Mock feedback; sign-in required for gated tools (Offer Comparison anonymous); Weekly Report on the existing `career-cron.js`; AI-estimated ranges with a disclaimer (+ live JSearch when `RAPIDAPI_KEY` set); and explicit authorization to auto-merge to `main` on green. The full implementation is in this PR — see **`TASK_SUMMARY.md`** for what shipped. The questions below are the original checkpoint, kept for the record.

---

# 7 New Tools — Implementation Plan & Open Questions

_Response to `7_tools_prompt.md`. I've read the spec and mapped it against the current codebase before starting the build. Below is what I found, the plan I'd execute, and a handful of decisions I need you to confirm before I write ~2,000 lines across `server.js`, seven new pages, and the hub/dashboard/tracker integrations._

---

## 1. What already exists (good news — the scaffolding is real)

The spec assumes several pages that **do exist** in this repo, so I can extend rather than invent:

| Spec reference | Reality in repo | Notes |
|---|---|---|
| Free Tools Hub `/score` | ✅ `public/score.html` (57 KB) | Card catalog uses `.ft-card` anchors (cream `#fff` cards, `#E7DFD1` border, green hover). I'll add the 4 free cards here. |
| Pro Tools Hub `/pro-tools` | ✅ `public/pro-tools.html` | Uses `.pt-badge` / `.pt-badge--emp` pills. I'll add the 3 Pro cards here. |
| `/tools/*` pages | ✅ `public/tools/` (has `ats-keyword-extractor.html`, `resume-video.html`) | Served by `express.static({ extensions:['html'] })` via `_resolveHtmlFile`. New pages drop in as `public/tools/<slug>.html`. |
| Job Tracker `/job-tracker` | ✅ `public/job-tracker.html` + `job-tracker.js` + a Pro dashboard tab (shipped in #357) | Follow-up integration is feasible against its "Applied" status. |
| Employer Portal | ✅ `employer-hub.js` + `employer_*` tables + routes | The "add a card" ask is a small HTML edit. |
| Dashboard | ✅ `public/app.html` SPA with `showTab()` + Career Hub self-injecting sidebar | "New Tools" modal/badge fits the existing pattern. |
| Gating helpers | ✅ `isSubscriber(email)`, `getSessionEmail(req)`, `_quotaUsed/_quotaConsume` (day/week/total buckets), `usage_store` table | I'll reuse these rather than hand-roll counting. |

**Bottom line:** the build is large but not architecturally novel — every piece has a precedent to mirror.

---

## 2. Proposed plan (once questions below are settled)

**Data layer** (`server.js` startup, `CREATE TABLE IF NOT EXISTS`):
- `tool_usage`, `resume_versions`, `weekly_report_subscriptions` per the spec's SQL (adapted to `better-sqlite3` conventions already used here).
- Gating counts go through a small helper that keys on `user_email` + tool + period window (day / month), matching the spec's reset rules.

**API routes** (all under `/api/tools/*`, server-side gating before any Claude call):
- `offer-comparison` (free, no gate — pure scoring, no LLM needed; deterministic table + weighted score).
- `job-description-decode` (3/day) — Claude.
- `follow-up-generate` (5/month) — Claude.
- `mock-interview` (1/month) — Claude.
- `salary-negotiation` (1/month free trial → Pro) — Claude.
- `resume-version` (save) + `resume-versions` (list) — 2-version free cap via row count.
- `weekly-report/toggle` (Pro only) + the Monday email job.

**Frontend**: 7 pages in `public/tools/` matching the cream/green tool-page layout with the 中文/EN toggle, back button, upgrade banner/modal, and the Pro promo footer on free pages.

**Integrations**: `/score` + `/pro-tools` cards, homepage "New Tools" section, dashboard modal/badge, job-tracker follow-up button, tailor-tab A/B banner, employer-portal card.

**Tests**: `test/tools.js` (pure gating logic + route smoke tests against a temp DB, mirroring `test/career-hub-routes.js` — LLM routes exercised through seeded rows, not live calls). Plus `TASK_SUMMARY.md`.

---

## 3. Decisions I need from you before building

These genuinely change what I build; I don't want to guess on a PR this size.

### Q1 — Auto-merge to `main` ⚠️ (blocker)
The spec says **"Auto-merge to `main` once CI passes."** My operating rules for this environment require me to open a **draft PR** and **never merge to a protected branch without explicit permission**. I **will not** auto-merge. I'll instead: build → push to `claude/markdown-file-response-y8qolt` → open a **draft PR** → keep CI green. **Do you want to override anything here, or is draft-PR-and-you-merge acceptable?** (This is the one hard conflict.)

### Q2 — Is this a "build it all now" go, or a "plan first" checkpoint?
Your instruction was to put my **response/question in a Markdown file** — which reads like you want this checkpoint before I commit to the full build. Confirm: **proceed to build all 7 now**, or **iterate on this plan first?**

### Q3 — LLM model for the four AI tools
Career Hub uses `claude-haiku-4-5` for high-volume generative endpoints and `claude-sonnet-4-6` only for reasoning-heavy ones. I'd propose: **Haiku** for JD Decoder + Follow-Up + Mock-Interview questions; **Sonnet** for Salary Negotiation (needs market reasoning) and Mock-Interview answer feedback. OK, or force one model?

### Q4 — Gating window semantics
Spec says "reset midnight UTC" / "reset 1st of month" and count per `user_email`. Existing metered features key on **IP + date** in `usage_store`. I'll switch these new tools to **email-keyed** windows as the spec asks (requires sign-in — consistent with `/api/tailor`). Confirm **sign-in required** for the gated tools is acceptable (offer-comparison stays fully anonymous/free).

### Q5 — Weekly Report delivery mechanism
The repo already has an **in-process daily scheduler** (`career-cron.js`, gated by `CAREER_CRON=on`) because Railway cron can't attach the SQLite volume. I'll hang the Monday email off that same scheduler + Resend, rather than add a new Railway cron service. Good?

### Q6 — "Market data" for Salary Negotiation & realistic ranges for JD Decoder
There's no salary dataset in the repo and `RAPIDAPI_KEY` (JSearch) is optional/often unset. I'll have Claude produce **model-estimated ranges with an explicit "estimate, not a guarantee" disclaimer**, and use JSearch live data **only when `RAPIDAPI_KEY` is present**. Acceptable, or do you have a data source to wire in?

---

## 4. My recommendation

Answer **Q1 (draft PR, you merge)** and **Q2 (yes, build all 7)** and I'll execute the whole plan in one PR with the defaults I proposed for Q3–Q6 unless you say otherwise. Everything except the auto-merge is ready to go.
