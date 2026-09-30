# i18n PR 2b — Employee portal: Feed, My training, Library, Profile

Stacked on PR 2a (#574) — it reuses `app/employee/components/format.ts` (adds `fullDate`). Namespaces (5 locales, 97 keys each): `employeeFeed`, `employeeLibrary`, `employeeTraining`, `employeeProfile` (page + certifications + skills + account button).

## Decisions
- **Enums by key, not by `lib/*` English label maps:** feed post kinds, compliance states (signed/waived/pending/overdue), doc kinds (SOP/Safety/Policy/Training), certification status, skill levels 1–5, employee status. Unknown values fall back to the raw string rather than a missing-key error.
- **Library categories** (9 closed values from the seed) are translated for the filter chips and card labels. The English category string is still what is sent to the API, so filtering is unchanged.
- **Library item titles and the built-in training body content stay English.** They are the official US-government titles/videos/pages (OSHA, NIOSH, FEMA…, ~80 items); the videos themselves are English. Translating titles without translated content would mislead. Recorded for your list.
- Plurals (comments, quiz question count) use ICU `plural`. Dates use `Intl` via the shared helpers (`fullDate` for start/expiry dates, `toLocaleString(locale)` for post timestamps).
- `t` shadowing: the debounce `const t = setTimeout(...)` in `library-client.tsx` renamed to `timer`.
- User-generated content (feed posts/comments, cert names, training doc titles/bodies authored by the employer) is data and untouched.

## Verification
`tsc --noEmit` clean · `next lint` clean · `next build` OK · key parity 0 missing/extra ×4 locales · placeholder parity OK · every used key resolves · 485 messages format with 0 ICU errors in 5 locales. Not verified: in-browser rendering; native-speaker review.
