# i18n PR 2a — Employee portal: Home, Schedule, Hours, Time off, Documents, Messages

Namespaces (all 5 locales, 116 keys each): `employeeCommon`, `employeePortal` (layout fallback + access gate), `employeeHome`, `employeeClock`, `employeeSchedule`, `employeeHours`, `employeeTimeOff`, `employeeDocuments`, `employeeMessages`.

## Notable decisions
- **Locale-aware dates/times.** `lib/time-hub.ts` hard-codes English (`DOW_LABELS`, `en-US`, "9:00 AM") because it also feeds CSV export and the employer tabs, so it is left untouched. The portal uses new `app/employee/components/format.ts` (`weekdayName`, `shortDate`, `dateRange`, `weekRange`, `clockTime`, `timeOfDay`) built on `Intl`. Weekday/month names and 12h/24h clock now follow the viewer's language.
- **Server components** (home page, layout, portal gate) use `getTranslations` / `useTranslations`; the layout's "Your workplace" fallback is translated.
- **Enums by key:** time-off kinds and review statuses (`employeeCommon`), document types/statuses, time-off statuses. Unknown doc status/type values fall back gracefully rather than showing a raw key.
- Day counts use ICU `plural`; the recurring-availability label ("Mondays") is a per-language template (`availability.weekdayRecurring`).
- `t` shadowing: `timeOff.flatMap((t)=>…)`, `.filter/.map((t)=>…)` in `schedule-client.tsx` renamed to `off`.
- Duration strings ("2h 30m") still come from `formatHM` with `h`/`m` abbreviations in every language. Left as is; say if you want localized units.
- User-authored content (announcement titles/bodies, shift notes, checklist item labels, employer names) is data and not translated.
- Server error strings shown via `d.error` remain English with a translated fallback (same policy as PR 1).

## Verification
`tsc --noEmit` clean · `next lint` clean · `next build` OK · key parity 0 missing/extra ×4 locales · placeholder/tag parity OK (ICU plurals excluded by design) · every `t()` key used in the changed files resolves · all 580 messages in these namespaces format in all 5 locales with 0 ICU errors. Not verified: in-browser rendering per locale; native-speaker review.

## Not in this PR
Feed, Training, Library, Profile (PR 2b). Also not covered (not in your list): employee Settings page and the `/employee/accept` invite flow (the latter overlaps PR 4's auth-flow copy).
