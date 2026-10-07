# Fix 7 — Mock interview policy alignment (report)

**Policy applied:** all 15 practice questions are free; detailed AI answer feedback and full mock interviews are Pro-only. No partial limits such as "1/month".

## Result: the product was already consistent — only stale internal wording remained
Audited every surface (platform app, legacy site, API routes, FAQ/JSON-LD, pricing, plan comparison, all five locales, emails, onboarding). Nothing user-facing still says "1/month" or offers a free mock-interview sample.

### Verified consistent (no change needed)
| Surface | Evidence |
|---|---|
| Coach dialog (en/es/fr/hi/zh) | `interviewCoach.freeQuestions` = "Free: all 15 practice questions · Detailed feedback + mock interview are Pro" in all 5 locales; Pro line "full set + mock interviews" |
| `/api/interview/questions` | returns all 15 to every signed-in user, `lockedCount: 0` |
| `/api/interview/feedback` | free = basic score + 1 strength + 1 improvement (enforced server-side); Pro = detailed (multiple strengths/improvements + model answer) |
| `/api/interview/mock` | 402 `pro_required` for non-Pro |
| Legacy `POST /api/tools/mock-interview` (`server.js`) | 402 `pro_required` for anonymous and free callers; `TOOLS.LIMITS.mockInterview = { proOnly: true }` |
| `public/pricing.html` | Free: "all 15 questions, basic answer feedback"; Pro: "Detailed interview feedback & full mock interviews" |
| `public/faq.html`, `public/index.html` (visible FAQ + JSON-LD) | Free = "all 15 interview questions"; Pro = "detailed interview feedback and full mock interviews" |
| `public/tools/mock-interview.html`, `public/app.html` tool card | "Pro" badge / "Full mock interviews are Pro" |
| Platform help copy (`help.tools.interview`) | "Pro adds detailed feedback and a full mock interview" |
| Emails / onboarding | no mock-interview or interview-quota mentions found |
| Existing regression guard | `test/browser/audit-followup.js` R3-2 already asserts no "1 free mock / 1 mock interview a month" claims remain |

### Changed (stale wording only — no behavior change)
- `tools-core.js:193` — comment "(1/month free)" → "(Pro-only; no free allowance)".
- `NEW_TOOLS_PLAN.md:39` — "mock-interview (1/month)" annotated as superseded by Pro-only.
- `resumetailored-platform/INTERVIEW_COACH.md` — doc claimed free sees only 5 questions with a blurred "Upgrade to see all 15" card; corrected to all 15 free (three spots).

### Found, deliberately not changed
- `interview-coach.tsx` still contains a dormant "Upgrade to see all N questions" blur card (and `upgradeSeeAll` message key). It renders only when `lockedCount > 0`, which the server never sends, so it is unreachable. Left in place to keep this change copy-only; safe to delete later.
- Legacy Career Hub (`career-hub.js` `CH.LIMITS`, per CLAUDE.md "Interview behavioral free, technical + Score my answer Pro, 5/day") is a **different feature** (Interview Prep in the Express app), not the Coach mock interview. Not touched; flag if you want that policy reconciled too.
- Historical report files (`LIVE_AUDIT_FIX_REPORT.md`, `LIVE_AUDIT_TOOLS_REPORT.md`) mention "1/month" only to say it was removed; left as history.

## Verification
Grep-based audit of code, locales, HTML and docs (above). No runtime code changed, so no test changes; UI copy not checked in a browser.
