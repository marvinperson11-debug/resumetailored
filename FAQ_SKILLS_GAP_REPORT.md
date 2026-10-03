# Skills-gap fix, preview banner, /faq page — report

## Section 0 — Skills gap (platform)
- Test written first: `resumetailored-platform/scripts/test-skills-gap.cjs` (`npm run test:skills-gap`). Initial run: **7 checks failed** (`teams.`, `features.`, `react.` kept their periods; compounds not matched; casing/plural misses).
- Fix in `lib/skills-gap.ts`: trailing punctuation stripped (inner dots kept: `node.js`); plurals folded (`teams`≈`team`); hyphenated compounds emit the compound AND its parts and match either way (`data driven` ≈ `data-driven`); singular/plural job terms merged so lists stay unique and disjoint → "IN YOUR RESUME (n)" / "MISSING (n)" equal the chips rendered.
- After fix: **ALL PASS**.

## Section 1 — Cleanup (platform)
1. **Sam Lee resume — NOT deleted.** Not in the repo (only prompt templates in `lib/ai.ts` use `[City, State | Phone | Email]`, left alone). It's a live DB row (`resume_drafts`); this environment has no Supabase credentials.
2. **"Training signed: Training training" / "Marvin person" — NOT changed.** Also live data (`training_docs`/`acknowledgments`/`employees`). 
   - Prepared `supabase/one-off/2026-10-cleanup-demo-rows.sql`: each block previews with SELECT, the DELETE/UPDATE lines are commented out — review and run by hand in the Supabase SQL editor. Not a migration, so it won't auto-run.
   - If "Marvin person" is the Clerk profile name, fix it in Clerk (not SQL).
3. **Preview banner — done.** New `components/preview-data-banner.tsx`, rendered in `app/employer/layout.tsx` (including the locked-gate branch) and `app/candidate/layout.tsx`, driven by `access.preview` from `lib/plan.ts` (unchanged; who can preview unchanged). String `planPreview.dataBanner` added to en/es/fr/zh/hi.

## Section 2 — Legacy site
- `public/faq.html` + `GET /faq` in `server.js` (same pattern as `/pricing`; `/faq/` also 200). 11 Q&As (6 candidate, 5 employer), cross-linked to `/pricing`, FAQPage JSON-LD. Added to sitemap, homepage footer, and reserved subdomains.
- Homepage FAQ synced (free plan, fabrication, cancel) + new watermark, Pro-adds, Lifetime-cap answers (now 12) — HTML and JSON-LD.
  - Side effect: the homepage's Chinese-toggle table had 12 positional FAQ rows already out of sync with the DOM (they'd overwrite new answers with wrong translations). I removed those rows, so the FAQ stays English in Chinese mode until re-translated.
- Nav: both "For Employer(s)" nav links → `/for-employers` (hero card already was). `#pricing` links on the homepage point to a real `id="pricing"`, so no change; other pages use `/#pricing`, which also resolves.
- `grep -ri "1,000,000" public/ server.js`: **no matches** — nothing to delete.

## Checks
Platform: skills-gap test ALL PASS; `tsc --noEmit` clean; `next lint` no warnings; `next build` exit 0; `test:prompts` ALL PASS; `lint:i18n` OK (3014 keys × 5 locales).
Legacy: `node --check server.js` OK; booted locally: `/faq` 200, `/faq/` 200; no "1,000,000".

## Not completed
- Sam Lee resume deletion, Training-training entry removal, and "Marvin Person" display-name data fix (need production DB/Clerk access — SQL provided).
