# i18n PR 4b — Signer upload page, /join, sign-in/up copy, employee invite acceptance

Namespaces (5 locales, 81 keys each): `publicSign`, `publicJoin`, `authFlow`, `employeeAccept`, `pwa`.

## Covered
- `/sign/[id]` — the login-less signer upload flow (validation errors, slots, "is this one of the requested documents?" prompt, limits, footer) and its `<title>` (now `generateMetadata`). Recipients are external people opening an emailed link, so this follows their browser/cookie locale.
- `/join` — team-invite messages (invalid / not found).
- `/sign-in` and `/sign-up` custom copy around the Clerk widgets (loading states, "Employee portal" link, "already part of a team", "Download the app"). The Clerk widgets themselves were already localized via `@clerk/localizations`.
- `/employee/accept` — server messages + the whole branded client flow (code/password fields, three paths, errors).
- `components/pwa/install-app-button.tsx` — the install button label and the install help card (used on the auth pages and in the shells).

## Decisions / caveats
- **Clerk error text stays as Clerk returns it.** The accept flow shows `errors[0].longMessage` from Clerk first (for wrong password etc.); our translated text is only the fallback. Clerk's own messages are localized only if the instance is configured for it — flag if you want us to always show our strings for the common cases (wrong password, password too short).
- Rich text with embedded icons (`Share`, `Plus`) uses paired tags (`<share></share>`); self-closing tags render literally in next-intl, which I verified and avoided. Tag names never collide with variable names (`email` value vs `addr` tag).
- The 10 MB / 10-file limits remain hard-coded in the copy, as in the original (the client reads the true limit from the API for validation only).
- `t` shadowing: `const t = setTimeout(...)` in both auth pages renamed `timer`.
- Server error strings shown via `d.error` keep English with a translated fallback.

## Verification
`tsc --noEmit` clean · `next lint` clean · `next build` OK · key parity 0 missing/extra ×4 locales · placeholder/tag parity OK · every used key resolves · 405 messages format with 0 ICU errors in 5 locales; rich-text rendering with icons checked in all 5. Not verified: in-browser rendering, real Clerk sign-in/up round trip, native-speaker review.
