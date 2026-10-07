# Career Hub interview limits → same policy as the Coach (report)

**Policy applied:** ALL practice questions (behavioral and technical) are free. Free "Score my answer" = lightweight BASIC feedback (rating + one strength + one improvement). Detailed feedback stays Pro. The 5/day cap no longer applies to basic feedback.

## Structural check: nothing breaks
Technical questions were gated by a single `if` in `POST /api/interview/questions`. Everything underneath is kind-agnostic: the cross-user `interview_cache` is keyed by profession + seniority + kind + language (+ `PROMPT_VERSION`), so a technical set is generated once for everyone and then costs nothing; `interview_progress` is keyed by question hash; the pre-warm script already generates technical sets for the top 20 professions. No schema change.

## What changed
- `server.js`
  - `/api/interview/questions`: removed the Pro-only 402 for `kind: "technical"`.
  - `/api/interview/score`: no longer Pro-only. Free callers get the basic score from **claude-haiku-4-5**, `max_tokens: 300`, output trimmed server-side to 1 strength + 1 improvement + rating and **no revised answer**; no daily quota is read or consumed. Pro behavior unchanged (Sonnet, detailed, still capped at 5/day); Pro responses now carry `detailed: true`.
- `career-hub.js` (pure core): `LIMITS.answerScore` = `{ free: null (uncapped), pro: 5, period: 'day' }`; new `buildBasicScorePrompt` and `basicScoreShape` (clamps rating, enforces the basic shape whatever the model returns).
- `public/career-hub.js` (UI, EN + the Chinese dictionary): Technical button pill PRO → FREE; the answer box and "Score my answer" button show for everyone (the "🔒 Upgrade to get AI feedback" block is gone); free results show an upsell for detailed feedback (more points + revised answer); dashboard upsell no longer lists "technical interview prep" (now "detailed answer feedback").
- `CLAUDE.md` Career Hub notes updated.
- Tests: `test/career-hub.js` (limit surface, `basicScoreShape`, lightweight prompt) and `test/career-hub-routes.js` (free user gets technical questions; free scoring is never a 402 and doesn't touch the answer-score quota; Pro 5/day cap test unchanged). Full `test/*.js` loop passes (only `production-e2e.js` self-skips on Node 22).

## Cost note (please read)
Removing the cap means free basic scoring is only bounded by the existing per-minute limiter (10/min per client) plus the need for a signed-in account. A Haiku call at ≤300 output tokens is cheap, but it is uncached per answer. If it gets abused, the lever is a generous per-day ceiling in `CH.LIMITS.answerScore.free` — I did not add one because you asked for no cap.

## Not changed
- The Express **AI Interview Coach** (`/api/interview-coach/*`, `interview-coach.js`, `IC.LIMITS.freePerDay`) is a third, separate interview tool with its own free daily limit. You said "Career Hub", so I left it alone — say if you want it aligned too.
- The Platform Interview Coach was already on this policy (previous report).

## Verification
Automated tests above. No live/browser check; verify on the live Career Hub: free account → Interview Prep → Technical opens, Score my answer returns rating + 1 strength + 1 improvement + upsell.
