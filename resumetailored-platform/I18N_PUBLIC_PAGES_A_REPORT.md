# i18n PR 4a — Public job board, career sites, personal-site 404

Namespaces (5 locales, 75 keys each): `publicJobs`, `publicApply`, `publicCareers`, `publicSite`.

## Covered
- `/jobs` (filters, results, salary/date formatting), `/jobs/[jobId]` (detail + **apply form**), `/careers/[slug]` (`CareerSiteView` + page `<title>`/description metadata), `/site/[slug]` **404 page**.
- Remote / employment type enums via key lookup (`publicJobs.remoteType.*`, `employmentType.*`), shared with the career-site job rows.
- Salary uses the visitor's number grouping (`toLocaleString(locale)`) and a translated "up to {amount}". The literal `$` prefix is unchanged (same as before); job `salaryCurrency` is still appended on the detail page as data.
- Dates use the visitor's locale instead of the server default.

## Decisions / caveats
- **Public pages follow the visitor's locale** (cookie → `Accept-Language`, as already wired), not the employer's. The builder's live preview renders through the same `CareerSiteView`, so it shows the *employer's* UI language — that is expected, but worth knowing when a zh employer previews a page candidates will see in English.
- `CareerSiteView`'s "pure, no hooks" comment updated: it now calls `useTranslations`/`useLocale` (works in server and client renders; still no state/effects).
- **`/site/[slug]` serves stored HTML for the published personal site — that content is the owner's and is not translated.** Only the "Site not found" fallback is. The fallback is raw HTML, so translated strings are HTML-escaped (`esc`) and `<html lang>` follows the locale.
- Employer-authored content (company name/bio/mission, job titles/descriptions/requirements, benefits, testimonials) is data.
- `t` shadowing: `testimonials.map((t) …)` in `career-site-view.tsx` renamed `tm`; filter loops in `/jobs` use `ty`.
- Server error strings from the apply API still surface via `d.error` with a translated fallback (same policy as earlier PRs).

## Verification
`tsc --noEmit` clean · `next lint` clean · `next build` OK · key parity 0 missing/extra ×4 locales · placeholder parity OK · every used key resolves · 370 messages format with 0 ICU errors in 5 locales. Not verified: in-browser rendering per locale; native-speaker review.

## Next
PR 4b: `/sign/[id]` (signer flow), `/join`, sign-in/sign-up custom copy, and the employee `/employee/accept` invite flow.
