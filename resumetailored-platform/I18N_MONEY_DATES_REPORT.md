# Money & date formatting — items 7, 8, 9

**Status:** implemented in the Next.js platform (`resumetailored-platform/`), draft PR open. Stripe is untouched. Decisions for you are at the bottom.

## 7. Stripe — not touched
No Stripe file is in the diff: `create-checkout-session`, `create-employer-checkout-session`, the webhook and the env/price-id handling are byte-for-byte unchanged, so checkout sessions and charges stay in USD exactly as before. The new `PRICES_USD` constants are **display-only** (the $19 / $129 / $49 / $99 / $299 already hard-coded in UI strings); nothing reads them to create a charge.

## 8. Prices → `Intl.NumberFormat` (USD, selected UI language)
New `lib/format.ts` (isomorphic) + `lib/use-format.ts` (hook bound to the active next-intl locale). `formatMoney()` is the only way an amount is written: `Intl.NumberFormat(locale, { style: "currency", currency: "USD" })`, cached per locale/options. No `"$" +`, no manual symbol concatenation remains in displayed UI.

Verified output (Node 22 ICU):

| | en | zh | es | hi | fr |
|---|---|---|---|---|---|
| Pro monthly | $19.00 | US$19.00 | 19,00 US$ | $19.00 | 19,00 $US |
| Lifetime | $129 | US$129 | 129 US$ | $129 | 129 $US |
| 1,234,567.5 | $1,234,567.50 | US$1,234,567.50 | 1.234.567,50 US$ | $12,34,567.50 | 1 234 567,50 $US |
| $60K filter | $60K | US$6万 | 60 mil US$ | $60 हज़ार | 60 k $US |

Surfaces converted:
- **Subscription / upgrade cards:** `ProUpgradeModal` ("Start Pro — {price}/mo", "Pro Lifetime — {price} one-time"), `LockedFeature` ("Upgrade to Pro — {price}/mo"), `/employer-checkout` plan labels (Employer Portal / Scale / Corporate). These three were entirely English; I translated them (new namespaces `proUpgrade`, `lockedFeature`, `employerCheckout`, 34 keys × 5) because a localized price has to sit inside a localized sentence. The price is an ICU `{price}` argument, never part of the string.
- **Calculators** (employer Office): all results and formula lines, plus the numeric inputs echoed in formulas (hours, multiplier…) via `Intl.NumberFormat`.
- **Salaries:** public job board, job detail, career sites, Job Finder, Career Hub, salary filter options (now `$60K+` via compact `Intl`, message keys removed), send-document salary placeholder, application-tracker placeholder.
  - Employer-posted salaries are formatted in **the posting's own currency** (`salaryCurrency`, falls back to USD if invalid) — that is third-party data, not our price. The old code printed "$" in front of any currency and then appended "EUR"; it now renders e.g. `95 000 €` correctly.
  - Job Finder live listings now carry numeric `salaryMin/Max` from the API so the UI formats them per locale. The API's text `salary` stays en-US (via `formatMoney(n, "en")`, not string concat) because `parseSalary` sorting/insights and already-saved jobs read it; AI-generated listings show their text as given.

## 9. Dates → `Intl.DateTimeFormat` (selected UI language)
`formatDate / formatDateTime / formatDateTimeShort / formatTime / formatDateRange / formatWeekdayTime / weekdayName` — all `Intl.DateTimeFormat`, cached. Calendar days (`YYYY-MM-DD`) are read and formatted in UTC so they never shift a day; timestamps use the viewer's timezone. Ranges use `formatRange` ("28 ago – 27 sept 2026").

Hindi matches your example: `formatDate("2026-08-31", "hi")` → **31 अगस्त 2026** (see decision 2). English "Aug 31, 2026", French "31 août 2026", Chinese "2026年8月31日".

Converted: employer Jobs, Candidates, Team, Scheduler, Messages (+ employee threads), Employees (announcements, feed, start/expiry/due dates, which were raw ISO), Timesheets / Time-off / Schedule grid (were using English `lib/time-hub` labels — weekday names, week ranges, `9:00 AM` — now Intl), Documents, E-Signatures; the whole employee portal (its helper file is now a thin wrapper over the shared lib); candidate My Resumes, Application Tracker, Career Hub (milestone/target dates, were raw ISO), resume-tailor default title; notification bell; Office chart labels (route passes the viewer's locale). Everything that called `toLocale*(undefined | "en-US")` is gone from display code.

## Deliberately not changed (need your call if you want them)
- **Emails to candidates** (`lib/employer-notify.ts` interview time, fixed en-US/UTC) — recipients may have no locale on file; transactional mails with accounts already use their locale (`training-notify`).
- **Generated documents:** the signing-agreement date (`lib/docusign.ts`) and the cover-letter date (`lib/resume-templates.ts`) — these are contract/letter text in the document's language, not site UI.
- **AI prompts / report titles / CSV** (`lib/office-hub`, `lib/time-hub`) — English on purpose (model input, saved document titles, exports).
- **The marketing site's pricing page** lives in the legacy static site (`public/`), not this Next app; static HTML can't call `Intl` at build time, so it would need a small client script. Not touched.
- **Invoices / receipts:** this app has none (Stripe-hosted), so there was nothing to format. Adding an in-app billing history would just reuse `formatMoney/formatDate`.
- The Application Tracker's surrounding copy is still English (page never translated); only its dates/amounts changed.

## Decisions (resolved — defaults kept)
You chose to keep all three defaults. Guardrails and the string audit are in `I18N_AUDIT_AND_GUARDRAILS_REPORT.md`.

## Original decision notes
1. **"US$" in zh/es/fr.** `Intl` writes USD as `US$` / `$US` in locales whose own currency is not the dollar, to avoid ambiguity with e.g. pesos/francs. That is the correct, standard rendering and what you asked for (locale decides symbol placement). If you would rather always show a bare `$`, it is one option (`currencyDisplay: "narrowSymbol"`) in `lib/format.ts`.
2. **Hindi months.** Stock `Intl` abbreviates Hindi months ("31 अग॰ 2026"); to get your exact example, `lib/format.ts` uses the full month name for `hi` only (`optionsFor`). Remove that function for stock behaviour.
3. Compact filter labels ("$60K") come from `Intl` compact notation, so they read "US$6万" / "60 mil US$" — say if you'd prefer full numbers there.

## Verification
`tsc --noEmit` clean · `next lint` clean · `next build` OK · key parity 0 missing/extra ×4 locales · all 2,735 messages in the touched namespaces (incl. candidateTools) format in 5 locales with 0 ICU errors · formatter outputs above run directly in all five locales. Not verified: in-browser rendering of each screen per locale; there is no unit-test runner in this package, so `lib/format.ts` was checked with an ad-hoc script rather than a committed test.
