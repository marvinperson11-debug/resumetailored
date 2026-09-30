# i18n PR 5 — Candidate "My Resumes" (gap file)

`app/candidate/resumes/my-resumes.tsx` → new `candidateTools.myResumes` group (17 keys × 5 locales), following the existing one-group-per-tool convention inside `candidateTools`.

- All visible strings, the PDF tooltip, the delete `aria-label`, the error fallbacks and the default PDF title (`"Resume"`) are translated; the "Updated …" timestamp uses the active locale instead of `en-US`.
- The other gap file you named — the employer `documents-client.tsx` — was covered in PR 1 (#573); the employee `documents-client.tsx` in PR 2a (#574).
- `useCallback` deps now include `t` (lint) — it only changes when the locale does.
- Resume titles and content are user data and untouched.

Verification: `tsc --noEmit`, `next lint`, `next build` all clean; key parity 0 missing/extra across 5 locales; every used key resolves. Not verified: in-browser rendering; native-speaker review.
