# i18n status — audit, guardrails and what's left (PR #580)

**State:** #573–#579 are merged into `main`. #580 (money/date formatting + guardrails) is open; its new "Platform checks" workflow was still running when this was written, so **#580 is not merged yet**. I will merge it once that run passes.

## Straight answer on the audit and guardrail
Your message started at item 7, so I never received items 1–6, and nothing in PRs #573–#580 covered a hard-coded-string audit or a lint/CI guardrail — they covered the surfaces from your PR list plus formatting. Both now exist in #580. If items 1–6 contained other requirements, paste them and I'll check each one.

## Guardrails (no new dependencies)
| Guardrail | Where | Fails CI when |
|---|---|---|
| Money/date lint rules (error level) | `.eslintrc.json`, `npm run lint` | `toLocale(Date\|Time)String()`, hard-coded `'en-US'`, `"$" + n`, price literals like `"$19/mo"` in code or JSX text |
| Hard-coded-string ratchet | `scripts/i18n-audit.mjs --check`, baseline `scripts/i18n-baseline.json` | a file gains English prose or a UI label ("Save", "Sign out") not in the baseline; new files start at 0 |
| Message-catalog check | `scripts/check-messages.mjs` | locale keys differ from `en.json`, placeholders/tags differ, or a message fails to format with next-intl |
| CI workflow | `.github/workflows/platform.yml` | runs typecheck, lint, `lint:i18n`, build on PRs/pushes touching `resumetailored-platform/` (the existing `tests.yml` only covers the legacy Express app) |

Tested with a probe file (hard-coded price, `toLocaleDateString("en-US")`, `"$" +`, two English sentences): lint and the ratchet both failed; removing it passed. Limits: the audit is an AST heuristic over `app/` and `components/` UI code — it flags English prose and common single labels, but cannot see a lone word in a variable, runtime-built strings, or server/AI text. It stops regressions; it is not proof of zero English.

## Audit result
**415 hard-coded user-facing strings remain in 31 files.**

Still partly or fully English (relevant to Hindi/Spanish testing):
- **Candidate:** Application Tracker (45), Settings (34), Shareable links (27), Profile (17), LinkedIn import modal (14), Dashboard home (11), Web Studio editor/canvas/gallery (~127), public profile `/u/[username]` (8), a few strings in Cover Letter / Resume Video / Resume Tailor / Job Finder / tool modal.
- **Employer:** Schedule grid (39), Timesheets (14), Time off (12), Dashboard page (9), Onboarding modal (10), Career Site builder (6), Settings (4), "coming soon" placeholders (4), Employees demo placeholders (3).
- **Employee:** Settings (15).
- Admin-only plan-preview banner/switcher (3); `app/manifest.ts` description.

Everything in PRs #557/#558/#573–#580 is clean under the audit.

## Fixed in #580 because the audit found them on every page
Sign-out button (all sidebars), mobile "Close menu", app loading screen (was outside the i18n provider — moved inside) and its slow-load text, profile menu "Install app"/"Upload photo", Pro checkout toasts/errors, "Which door?" screen, language-preference text, "coming soon" pages and tool loader, candidate sidebar back-link, fallbacks ("Your company", "Pro (via your team)"), Messages tab header + empty state, chart render errors, site `<meta description>`. 43 new `shell` keys × 5 locales.

A real bug the new rule surfaced: Interview Coach **speech recognition was hard-wired to `en-US`**; it now listens in the UI language (`en-US / zh-CN / es-ES / hi-IN / fr-FR`).

## Decisions (yours)
Keep `US$` in zh/es/fr, full Hindi month names, compact salary-filter labels.

## Still open
- Legal-reviewed translations of document template bodies (`lib/document-templates.ts`).
- API error codes so server error strings can be translated.
- Localized training-library content.
- Native-speaker review of zh/es/hi/fr copy.
- **#576's hand-applied migration:** run `supabase/migrations/0041_activity_event_msg.sql`; until then new notifications stay English.
- Translate the files in the baseline (next biggest wins: Application Tracker, Candidate Settings, Employer Schedule/Timesheets/Time-off, Employer Dashboard, Shareable Links, Profile); after each, run `node scripts/i18n-audit.mjs --update` to lock the gain.

## Verification
Local: `npm run typecheck`, `npm run lint`, `npm run lint:i18n`, `npm run build` all pass (2,134 message keys × 5 locales). The new GitHub workflow is running on #580 and had not finished at the time of writing. Not verified in a browser.

Related reports: `I18N_MONEY_DATES_REPORT.md`, `I18N_AUDIT_AND_GUARDRAILS_REPORT.md`.
