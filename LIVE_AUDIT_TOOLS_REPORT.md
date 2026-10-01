# Mock-interview gate, free-tool auth check, and deploy status

Branch `claude/live-audit-fixes` · PR #585 → `main` (https://github.com/marvinperson11-debug/resumetailored/pull/585)

## 1. Legacy mock-interview endpoint is now Pro-only
`POST /api/tools/mock-interview` (Express) now returns **402 `pro_required`** — the same code and meaning as the new flow's `/api/interview/mock` — for **anonymous and free callers, on both actions** (`questions` and `feedback`). No sample question is generated and no scoring is done. The free-user monthly meter is gone (`tools-core.js` marks the tool `proOnly`). The existing page's 402 handler opens its upgrade modal with the server's message. Pro accounts behave as before.

Copy aligned to reality: `/tools/mock-interview` (eyebrow, meta/JSON-LD description, price 0 → 19.00, modal, ZH), the homepage card (badge "PRO", "With any Pro plan"), and the `app.html` tool list now say Pro, replacing last round's "practice questions free" wording (which described the old one-sample behavior).

Tests: `test/audit-regressions.js` asserts anonymous and free-account callers get 402 on both actions with no `result`, and that Pro reaches input validation (400). `test/tools.js` expectations updated to match.

## 2. Salary Negotiation and Offer Comparison — "no account" claims: **genuinely work logged-out → left alone**
Evidence (real requests against the booted app, now regression-tested):
- **Offer Comparison** — `POST /api/tools/offer-comparison` with no credentials returns **200** with scored rows. The server gate (`toolGate`) admits anonymous callers (it keys them by IP) and the tool is deterministic, no LLM. The page has no client-side login gate: `tools-hub.js` only acts on a 401, which this endpoint never returns.
- **Salary Negotiation** — anonymous `POST /api/tools/salary-negotiation` passes the gate and reaches input validation (**400 `missing_role`**, not 401/402). Free is unlimited; Pro adds market data and email templates. No page-level login gate either.

So "No account needed" / "no account" on the homepage cards (Offer Comparison, Salary) is accurate and unchanged.

**Two things worth your attention (not changed):**
1. Those two tool pages' own meta/subtitle text says *"Fill it out freely; sign in only when you compare/generate."* That is **inaccurate in the other direction** — no sign-in is actually needed. Say the word and I'll change it to match.
2. **Correction to my ATS ruling last round:** the *legacy Express* `/api/ats-scan` also works anonymously (an existing regression test asserts this). I reworded the ATS pages because the pages you reach it from gate on login at action (`RTFreeToolAuth.requireForAction`) and the new app's `/api/ats-scan` returns 401 — so the *product experience* needs an account. But the raw legacy endpoint does not. If you'd rather treat endpoint behavior as decisive (as I did here), the ATS pages' "no sign-up" wording could be restored; if you'd rather the endpoint match the experience, I can require auth on it. Your call.

## 3. Commit and deploy
- Committed and pushed. PR #585 opened (as a draft, per repo workflow) and I'm subscribed to it.
- CI (`Tests` and `Platform checks`) was queued at the time of writing. Deploys here run from `main` on Railway, so the deploy step is: CI green → mark ready → merge PR #585.
- **Not merged yet.** I won't merge on red CI. I'll merge when both checks pass; until then nothing has reached production.
- Reminder from earlier reports (carried into this deploy): the live Stripe checkout labeling check and the decoder-reliability fix have not been verified against live services — worth a quick look after deploy.

Local verification: all `test/*.js` pass (`production-e2e` self-skips on Node 22), browser test 55/55, `tsc`, `lint:i18n`, `next build`.
