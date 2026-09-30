# Hard-coded-string audit + CI guardrails

**Straight answer first:** I only ever received items 7–9 of your spec (the message started at "7."). Items 1–6 — which I understand included the full hard-coded-string audit and the lint/CI guardrail — never reached me, and nothing in the previous PRs did either: #573–#580 covered the surfaces from your original PR list plus formatting. So neither existed when you asked. I have now built both in this PR. If items 1–6 contained other requirements, please paste them and I'll check each one.

## What exists now
| Guardrail | Where | Fails CI when |
|---|---|---|
| **Money/date lint rules** (`no-restricted-syntax`, error level in `.eslintrc.json`) | `npm run lint` | `toLocale(Date|Time)String()`, a hard-coded `'en-US'`, `"$" + n`, a price literal like `"$19/mo"` in code or JSX text |
| **Hard-coded-string ratchet** | `scripts/i18n-audit.mjs --check`, baseline `scripts/i18n-baseline.json` | any file gains an English string literal / JSX prose / UI label ("Save", "Sign out") not in the baseline; new files start at 0 |
| **Message-catalog check** | `scripts/check-messages.mjs` | any locale's keys differ from `en.json`, placeholders/tags differ, or any message fails to format with next-intl in its own locale |
| **Workflow** | `.github/workflows/platform.yml` | runs typecheck, lint, `lint:i18n`, build on PRs/pushes touching `resumetailored-platform/` (the existing `tests.yml` only covers the legacy Express app) |

No new dependencies (uses `typescript`, `eslint`, `next-intl` already installed). Verified: a probe file with a hard-coded price, `toLocaleDateString("en-US")`, `"$" +` and two English sentences fails both lint and the ratchet; removing it passes.

Limits, stated plainly: the audit is a heuristic over `app/` and `components/` UI code (AST-based; ignores imports, class names, URLs, object keys, comparisons, translator calls, `app/api`). It flags English prose (2+ words) and a list of single UI labels. It cannot see a lone word in a variable, strings built at runtime, or text coming from the server/AI. Treat it as a ratchet that stops regressions, not as proof of zero English.

## Audit result
**415 hard-coded user-facing strings in 31 files** remain (down from 453 after I translated the shell chrome found by the audit — see below). Precision was checked by reading the output for translated files (false positives removed: `"use client"`, Tailwind class lists, HTTP verbs).

### Screens still partly or fully English (relevant to your Hindi/Spanish test)
Candidate:
- **Application Tracker** (45), **Settings** (34), **Shareable links** (27), **Profile** (17), **LinkedIn import modal** (14), **Dashboard home** (11), **Web Studio editor/canvas/gallery** (~127), public profile `/u/[username]` (8), a few strings in Cover Letter / Resume Video / Resume Tailor / Job Finder / tool modal.

Employer:
- **Time suite tabs: Schedule grid** (39), **Timesheets** (14), **Time off** (12), **Dashboard page** (9), **Onboarding modal** (10), Career Site builder (6), Settings (4), "coming soon" placeholders (4), Employees (3; demo placeholders).

Employee: **Settings** (15).

Admin-only: plan-preview banner/switcher (3). Static: `app/manifest.ts` description.

(Everything else — the surfaces in PRs #557/#558/#573–#580 — is clean under the audit.)

### Fixed in this PR because the audit found them on every page
Sign-out button (every sidebar), mobile "Close menu", the app loading screen (was rendered outside the i18n provider — moved inside) and its "taking longer" text/Refresh, profile menu "Install app"/"Upload photo", Pro checkout toasts/errors (`upgrade-flow`), the "Which door?" screen for team accounts, language-preference description, "coming soon" pages and tool loader, candidate sidebar back-link, employer/candidate fallbacks ("Your company", plan label "Pro (via your team)"), Messages tab header + empty state, chart render errors, and the site `<meta description>`. 43 new keys × 5 locales in `shell`.
Also a real bug the new rule surfaced: the Interview Coach **speech recognition was hard-wired to `en-US`** — it now listens in the UI language (`en-US / zh-CN / es-ES / hi-IN / fr-FR`).

## Decisions recorded (from you)
Keep `US$` in zh/es/fr, full Hindi month names, and compact salary-filter labels (defaults).

## Suggested next step
The baseline is the to-do list: translate a file, run `node scripts/i18n-audit.mjs --update` to lock the gain in. The next biggest wins for your testers are **Application Tracker, Candidate Settings, Employer Schedule/Timesheets/Time-off, Employer Dashboard, Shareable Links, Profile**.

## Verification
`npm run typecheck`, `npm run lint`, `npm run lint:i18n`, `npm run build` all pass locally (2,134 message keys × 5 locales). The new GitHub workflow has not run yet (it runs on this PR). Not verified in a browser.
