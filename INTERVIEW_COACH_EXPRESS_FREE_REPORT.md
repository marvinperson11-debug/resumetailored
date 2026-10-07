# Express AI Interview Coach → same policy as the Career Hub (report)

**Policy:** every practice question free, no daily limit; free = BASIC feedback (overall score + one strength + one improvement); detailed feedback Pro-only.

## What it was
`/api/interview-coach/question` gated free users to **1 question/day** (`IC.LIMITS.freePerDay`, metered in `tool_usage`), then 402 `quota`; feedback was the full detailed card for everyone; the page copy sold "unlimited questions".

## What changed
- `interview-coach.js` (pure core): removed `freePerDay`; added `toBasicFeedback`, `buildBasicFeedbackPrompt`, `validateBasicFeedback`; feedback objects now carry `detailed: true|false`.
- `server.js`
  - `/question`: no gate, no usage recording; the whole 8-question bank is served in rotation. Response `locked` now lists `detailed, voice, report, progress` (no `unlimited`, no `remainingFree`).
  - `/feedback`: **free** → basic shape. Signed-in free users get a small AI call (`_aiComplete`, `max_tokens: 250`, which defaults to Claude Haiku unless `OPENAI_API_KEY` routes it to gpt-4o-mini, as before) and the result is trimmed server-side to 1 strength + 1 improvement + a ≤200-char summary, no score breakdown. **Anonymous** practice gets the deterministic heuristic only (no LLM spend), also trimmed to basic. **Pro** unchanged (detailed, 600 tokens, saved to progress).
  - Voice mode, delivery report and progress history remain Pro (they are modes/features, not feedback depth — you didn't ask to change them).
- `public/interview-coach.html`: free users see the overall score only (per-dimension breakdown hidden) plus the Pro preview; scrim copy now sells detailed feedback/voice/progress, not "unlimited questions"; intro note updated. `public/tool-landing.html` card copy updated. `CLAUDE.md` documents the policy.
- Tests: `test/interview-coach.js` (basic shape/validator/prompt, no `freePerDay`) and `test/interview-coach-routes.js` (13 free questions in a row never 402, whole bank covered, free feedback is basic, anonymous basic, Pro detailed). Full `test/*.js` loop passes.

## Notes / not changed
- The question bank is 8 behavioral questions with no technical set, so "all practice questions" = those 8; nothing new was added.
- Cost: free signed-in scoring is uncapped and bounded only by the existing 20/min limiter; the 250-token Haiku call keeps it cheap. If abused, add a per-day ceiling.
- Verified by automated tests only; check live in a browser (free account: many questions, basic score card + upsell; Pro: full breakdown).
