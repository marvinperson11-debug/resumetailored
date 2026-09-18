# Employer portal UI polish (3 items)

Branch `claude/employer-ui-polish` → **draft PR (link after push)**. `tsc`/`lint`/`build`/guard test all green; no new deps.

## 1. Interview email sender name → employer's business name
Candidate-facing employer emails now send under the **employer's business name** as the From **display name**, with the address unchanged (`noreply@resumetailored.com`).

- `lib/email.ts` — `sendEmail` gains an optional `fromName`; new `fromWithName(baseFrom, name)` swaps only the display name on the `Name <addr>` string (name quoted + stripped of header-breaking chars), keeping the address. No `fromName` → default `ResumeTailored`.
- `lib/career-site-store.ts` — new **read-only** `getCareerSiteCompanyName(employerId)` (selects `career_sites.company_name`; **no** row creation, unlike `getCareerSite`).
- `lib/employer-notify.ts` — `context()` derives `fromName` = `career_sites.company_name` → falls back to `employer_profiles.company_name` → else undefined (default `ResumeTailored`). Passed on **all candidate sends**: interview **scheduled/rescheduled**, interview **cancelled**, and new **message** emails. (The interviewer/host email — sent to the employer themselves — is left as the default.)

So a candidate sees e.g. **"Acme Corp <noreply@resumetailored.com>"**, and replies still go to the recruiter (reply-to unchanged).

## 2. Schedule form modal — mobile overlap fixed
The `Modal` card had **no max-height**, so a tall form (the Schedule interview form) overflowed and relied on the outer overlay scroll — on mobile the last fields (**Record interview** toggle + **Schedule** button) ended up stuck under the browser chrome, needing repeated scroll/taps. (Nothing was actually overlapping z-index-wise — the shell's sidebar/drawer/header are all below the modal's `z-[60]`.)

- `app/employer/components/ui.tsx` — the card is now `flex flex-col` capped at `max-h-[calc(100dvh-2rem)]` (sm: `-4rem`), the header is `shrink-0`, and the **body scrolls internally** (`min-h-0 flex-1 overflow-y-auto`). `dvh` tracks the collapsing mobile address bar, so the whole form is reachable and scrolls cleanly. This improves every employer modal, not just the scheduler.

## 3. Dashboard stat cards → links
The four dashboard stat cards are now tappable, navigating to their sections, with hover + press affordance and the same styling.

- `app/employer/page.tsx` — each card is a `next/link` `Link`: **Active job postings → /employer/jobs** (Hire), **Total applicants → /employer/candidates**, **New this week → /employer/candidates**, **Team members → /employer/team**. Same Panel look (`rounded-xl border border-border-gold bg-white/[0.04] p-5`) plus `hover:border-violet/40 hover:bg-white/[0.07]`, icon tile `group-hover:bg-violet/25`, `active:scale-[0.99]`, and a focus ring for keyboard users.
  - Note: "New this week" points at `/employer/candidates` — the candidates page only supports a `?jobId` filter today, not a time filter, so per your "or just Candidates" it links to the list.

## Files
- Changed: `lib/email.ts`, `lib/career-site-store.ts`, `lib/employer-notify.ts`, `app/employer/components/ui.tsx`, `app/employer/page.tsx`
- New: `test/employer-ui-polish.js`

## Quality gates
`tsc` ✅ · `lint` ✅ · `build` ✅ · `node test/employer-ui-polish.js` ✅ · no new deps · no migration.
