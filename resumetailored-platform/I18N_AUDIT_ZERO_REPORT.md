# i18n audit → zero: final report

**Result: `node scripts/i18n-audit.mjs` reports `Hard-coded user-facing strings: 0 in 0 files`** (415 in 31 files at the start of this round). `scripts/i18n-baseline.json` is now empty, so any new hard-coded string fails `lint:i18n` in CI.

## PRs
| PR | Area | Audit after |
|---|---|---|
| #581 (merged) | Candidate pages: Application Tracker, Settings, Shareable Links, Profile, LinkedIn import modal, Dashboard, tool chrome/labels, public `/u/[username]`, employer slug placeholders, plan-preview banner/switcher, PWA manifest | 415 → 236 |
| #582 (merged) | Web Studio: panels, editor, canvas, gallery | 236 → 113 |
| #583 | Employer Schedule/Timesheets/Time off/Dashboard/Onboarding/Career-site note/Settings/Employees placeholders, Employee Settings, leftovers | 113 → 0 |

## Checks (run locally on every PR; CI `platform` + `test` green on #581/#582)
- `tsc --noEmit`, `next lint`, `npm run lint:i18n` (audit + message check), `next build`: pass.
- Message parity: **2817 keys × 5 locales (en, zh, es, hi, fr)**, placeholder/tag parity and ICU formatting pass (`scripts/check-messages.mjs`).
- ICU render test (every key of every touched namespace rendered via `createTranslator` in all 5 locales): 0 errors.
- Prices/dates: ICU placeholders (`{value}`, `{date}`, `{when}`, plural `{count}`/`{n}`); no string concatenation. Stripe code untouched.

## Bugs caught along the way
- A strings-merge step wrote dotted namespaces (`candidateTools.coverLetter`) as literal top-level keys, which next-intl cannot resolve. Fixed in #581 and `check-messages.mjs` now **fails on any key segment containing a dot**.
- The first audit missed sentences with 1-letter words ("Select a conversation") and a few single-word labels ("Upgrade"); the heuristic was tightened and those were translated. The zero therefore reflects the stricter audit.

## Decisions / judgement calls
- Cover-letter prompt scaffolding (`Name:`, `Company:` …) moved to `lib/cover-letter-prompt.ts`: model-facing, not UI.
- Starter content stored inside generated Web Studio sites ("Your Name", "About") is user-authored content, not translated.
- CSS value strings and the `"Resume video"` API title are explicitly allow-listed in the audit (with comments).
- Time-off "withdrawn" note is stored in the employer's UI language at write time.
- Sample names/placeholders (Acme Inc., Jordan Rivera, Line Cook …) are localized.

## Still out of scope / open
- Native-speaker review of zh/es/hi/fr copy (machine-quality translations by me).
- Legal template bodies, server/API error strings, training-library content remain English by earlier decision.
- Migration 0041 (`activity_events.msg jsonb`) must still be applied by hand.
- The audit is heuristic; a zero means no detectable literals, not a proof.
