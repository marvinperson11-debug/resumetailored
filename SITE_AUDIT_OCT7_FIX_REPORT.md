# Oct 7, 2026 site-audit fixes — report

Branch changes are **not deployed by me**: I pushed a branch and opened a draft PR; deploy happens on merge via the normal Railway flow. Nothing below is "verified live".

## Fix 1 — Membership nav link (LEGACY marketing site)
- **Changed:** `public/index.html:1141` nav "Membership" `href="#pricing"` → `href="/pricing"` (matches footer).
- **Tests updated:** `test/navigation-flows.js` (expects `/pricing`); `test/browser/audit-followup.js` (asserts `/pricing`; dropped the click-lands-on-`#pricing` step, which would navigate away mid-test — run by hand, not in the loop).
- **Verification:** full `test/*.js` loop passes (only `production-e2e.js` self-skips: needs Node 20, sandbox has 22). The post-deploy curl check (`grep -c 'href="#pricing"'` == 0) is **not yet satisfiable**: other `#pricing` links remain on the homepage (see below), so that count will be 3, not 0. The nav link itself will read `href="/pricing"`.
- **Discrepancy with the audit:** the audit's premise ("homepage has no element with id `pricing`") is wrong. Live `curl https://resumetailored.com/` shows `id="pricing"` (count 1, the Plans section), and the old link worked; an earlier audit round deliberately set it to `#pricing` and tested that the click lands there. I made the change you asked for regardless; revert is one line if you'd rather keep the in-page scroll.
- **Anchor sweep:** scanned every `public/**/*.html` for `href="#id"` with no matching `id` — **0 broken anchors**. Not changed: three other homepage links still use `#pricing` (lines 2491, 2566, 2604, "Included with Pro — see plans") — they work, so left alone. `public/job-tracker.js` sends upgrades to `/#pricing`, also working.

## Fix 2 — Job Decoder counter (PLATFORM) — **no code change**
- **Branch taken:** the limit IS enforced, so the right outcome is a visible counter — but the counter already exists in the deployed code.
- **Evidence:** `app/api/decoder/decode/route.ts` — `FREE_PER_DAY = 3`; POST returns 402 `daily_limit` once `decodesToday()` ≥ 3; GET returns `{used, limit}` (`limit: null` for Pro). `app/candidate/tools/decoder-key.tsx:128-133` renders `quotaUsed` = "{used} of {limit} free decodes used today" (+ `QuotaWarning`) whenever `limit !== null`.
- **Why the audit saw none:** the counter is deliberately hidden when `limit === null` (Pro), and the audited account has candidate Pro active (footer shows "Pro — unlimited"). The Plan & billing "3/day" copy (`plan.freeDesc`) renders only for non-Pro. So dialog and billing copy already agree per plan. I did not alter either. Worth a second look only if a *Free* account also shows no counter (would indicate the GET `/api/decoder/decode` call failing silently — it swallows errors).

## Fix 3 — Header plan badge (PLATFORM) — **no code change; could not reproduce in code**
- The "Pro · active" string exists in exactly one place: `CandidateSidebar` (`components/candidate-sidebar.tsx:189`), mounted only by `app/candidate/layout.tsx`. The employer shell uses a separate `EmployerSidebar` whose footer badge shows the employer **tier** name (`tierLabel(normalizeTier(access.tier))` from `app/employer/layout.tsx`). No component renders one side's plan on the other side's pages, and `Access.plan` is a single value per account (`lib/plan.ts`), so a user can't hold "candidate Pro + employer Free" at once except an admin (admin bypass ⇒ Pro on candidate side, Corporate on employer side, and preview cookies are single `side:plan`).
- **Most likely cause of what was seen:** the avatar menu (`components/profile-button.tsx`) routes **Profile/Settings to `/candidate/*` even when opened from `/employer`**, landing on candidate pages that show the candidate badge. That is a navigation leak, not a badge bug. I did not change menu routing (outside the stated fix); say the word and I'll point those items at `/employer/settings` when the user is on the employer side.
- Neutral pages: none of the neutral surfaces (sign-in, public pages, `/employee`) render a plan badge today, so nothing needed hiding.
- If the live site still shows it, it's likely running older code than this repo — please send the exact URL/path where the badge appeared.

## Fix 4 — Scheduler AI summaries (PLATFORM)
- **Accuracy check:** `lib/employer-plan.ts` `canInterviewAiSummary` is true for **Scale and Corporate** (and admin); header comment lists "Scale $99 → Video 50/mo + AI summaries"; summaries are generated on recorded interviews (`recordHintFull`). The claim is accurate.
- **Gap found:** the only hint ("AI summaries are a Scale+ feature") rendered only for Portal-tier, so Scale/Corporate users (the ones who have the feature) saw nothing.
- **Changed:** `app/employer/scheduler/scheduler-client.tsx` — the hint line under the quota bar now always renders when video isn't locked, adding for Scale+: "Recorded video interviews are transcribed and auto-summarized with AI on your plan." New message key `employerScheduler.summariesIncluded` added to all five locales (en/es/fr/hi/zh). Portal still sees the existing Scale+ upsell; Free still sees the locked banner (unchanged).
- **Verification:** key parity across the 5 catalogs checked by script and JSON parses; `scripts/i18n-audit.mjs --check` passes. **Not run:** `tsc`, `next build`, `check-messages.mjs` — platform `node_modules` aren't installed in this sandbox. The platform has no unit tests covering this component. Live UI verification requires a browser on a Scale-tier account.

## Found, deliberately not changed
- Mock Interview copy, Walmart company bio, any production data: untouched, per scope.
- Avatar-menu Profile/Settings always going to `/candidate/*` (see Fix 3).
