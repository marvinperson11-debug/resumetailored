# Live-audit follow-up — owner decisions implemented

Branch `claude/live-audit-fixes` · committed locally · **not pushed, not deployed**.

**Checks run:** `test/browser/audit-followup.js` **55/55 pass** (Chromium) · all `test/*.js` pass (except `production-e2e`, which self-skips on Node 22) · `tsc --noEmit` ✅ · `lint:i18n` ✅ · `node --check server.js` ✅.

## What I did per decision

| # | Decision | Result |
|---|---|---|
| 1 | Decoder 3/day | Kept. No change. |
| 2 | Direct app link + keep learn-first path | Hero door still goes straight to the app. **"How it works"** (`/how-it-works`) added to the homepage main nav and mobile menu, **and** to the shared site-nav used on every other page (EN + ZH). I also pointed the shared nav's "Membership" at `/pricing#pricing`. |
| 3 | Template packs ≠ plans | The old "Career Levels" block is now a **"Template packs"** section (dashed, tinted band, distinct from Plans), with a one-line descriptor: *"Resume styles matched to your level — not separate plans. Basic is free; Professional and Executive come with the single Pro plan."* The pricing block is now headed **"Plans"**. **What the code says:** neither pack is sold separately. Both cards' CTAs went to the same `?upgrade=pro` link — one Pro subscription, **$19/month recurring or $129 one-time lifetime**. So the cards now read "Template pack · Included with Pro" with a "see plans →" button; the misleading "$19.00/mo" badges and "Go Executive — $19/mo" buttons are gone. ZH strings updated to match. |
| 4 | Mock interview Pro-only | Reworded every "1 free mock interview/month" claim: homepage card, `app.html` tool list, `/tools/mock-interview` page (title, eyebrow, upgrade modal, ZH). New copy: *practice questions are free; full mock interviews are Pro.* No metering built. **Note (existing behavior, not changed):** the legacy Express endpoint (`/api/tools/mock-interview`) still lets a free account generate **one sample question per month** (it slices the result to 1 question for non-Pro). That matches the new wording ("practice questions free"), but if you want it fully Pro-only, say so and I'll gate it. The new Next app's mock was already Pro-only (HTTP 402). |
| 5 | ATS "no sign-up" claims | **Account is required**, so I reworded. Evidence: the Next endpoint `/api/ats-scan` returns 401 without a session; the legacy `/ats-score-checker` and `/tools/ats-keyword-extractor` pages call `RTFreeToolAuth.requireForAction()` before running (login at action); `/free-ats-resume-checker` is a landing page whose CTA goes to the app. (The legacy Express `/api/ats-scan` itself does not check auth, but no page reaches it signed-out.) ~35 pages updated to "Free to start, no credit card required": ATS pages, alternatives pages, how-it-works, flyers, blog posts + `.md` sources, blog OG cards, `llms.txt` heading, EN/ZH home dictionaries. I also removed the "Free account required: ✗ competitors / ✓ us" comparison row, which had become false. **Left alone on purpose:** Offer Comparison Calculator "No account needed", Salary tool "no account", `tool-landing.html` ("Anonymous by design") — I did not verify those tools' auth; tell me if you want them checked. |
| 6 | Legacy `employer.html` | **Fully dead** — left as is. `server.js` 301s `/employer` and `/employer.html` to `app.resumetailored.com/employer` before static serving, and it is not in the sitemap. Browser test confirms the redirect chain. |
| 7 | Translations | zh/es/fr/hi drafted (natural, not literal) for: decoder quota, `seatGuard*` (ICU plural kept per language), `officeFeature`, Settings plan keys, `freeQuestions`, `freeDesc`, URL-import message, "Account owner", the sign-in employee note, and "Portal plan" in checkout. The homepage ZH dictionary covers the new hero, nav, template-pack and mock-interview copy. Native-speaker review still recommended for es/fr/hi. |
| 8 | Browser verification | See below. |

## Browser verification (Chromium, real DOM + geometry)
Driven by new `test/browser/audit-followup.js` (needs `npm i --no-save playwright-core esbuild`; skips cleanly without). Marketing pages run on the real Express app. App components (real React source) are bundled with esbuild with Next/Clerk stubbed, styled by the app's own Tailwind config. **Scope caveat:** CTA checks assert the rendered `href`; they do not navigate into Clerk-protected `/employer-checkout`, which needs a live session.

| Item | Result |
|---|---|
| #1 CTAs → checkout (locked banner Portal/Scale, tier note, quota bar, snackbar, sidebar footer Free→portal & Portal→scale, full-page gate; Settings Free→portal, Scale→corporate; Team guard; Office banner) | **PASS** — none point at a marketing page |
| #2 Office banner on Free/Portal, absent on Scale | PASS |
| #7 counters never exceed max ("3 of 3") | PASS |
| #16 Select — fits container at 300/360/700px, dark color-scheme, long titles truncate | PASS. Fails when the fix is reverted. Caveat: geometry was already inside its container before the fix, so the real-world symptom ("visually fails") was most likely the native dropdown rendering light-on-dark; I verified the computed style, not a native popup (not capturable headless). 🔍 eyeball it once. |
| #19 banner wrap — text not clipped/squeezed, button wraps below at 340/390/900px | PASS. Fails (text squeezed to ~178px at 340) when the fix is reverted. |
| #20 Team seat guard (no invite form) | PASS |
| #22 nav "Jobs" | PASS |
| #23 PRO pills: Free sees them, Pro does not | PASS |
| #24 Settings plan panel | PASS |
| #25 preview banner follows cookie (mount, clear, focus) | PASS |
| #30 scroll-margin ≥ 80px; Membership click lands on `#pricing` | PASS |
| #33 "Account owner" instead of `owner@account` | PASS |
| Marketing: nav links, hero, door link, Template packs vs Plans, $129 shown, `/cancel.html` reachable, `/employer.html` dead, stale claims gone | PASS |

## A bug the tests caught in my earlier work
My `/pricing/` → `/pricing` redirect (previous round) used `app.get('/pricing/')`. Express routing is non-strict, so it matched `/pricing` itself and would have **redirected `/pricing` to itself in a loop**. `test/audit-regressions.js` flagged it. Fixed with a literal trailing-slash check; `/pricing` → 200, `/pricing/` → 301 is now asserted in the browser test.

## Existing tests updated (owner decision changed the expectations)
`test/navigation-flows.js`: door now targets the app, nav gains "How it works", Membership → `#pricing`, shared nav is 4 links (was "exactly three").

## Not done / still open
- Stripe checkout labeling (verify-only item) — no Stripe keys here.
- Salary / Offer Comparison "no account" claims unverified (see #5).
- Decoder reliability fix is still unverified against the live model.
- Native review of es/fr/hi copy.
