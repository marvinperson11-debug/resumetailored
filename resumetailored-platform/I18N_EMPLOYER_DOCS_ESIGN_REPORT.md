# i18n PR 1 — Employer Documents + E-Signatures + tier-gating copy

**Status:** PR 1 of 5 done (plus #557/#558 merged). PRs 2–5 (employee portal, notification bell, public pages, gap files) are **not started** — see "Not done" and "Premise discrepancy" below.

## What changed

| Surface | Namespace | Notes |
|---|---|---|
| Documents page (list, editor toolbar, viewer, Received & signed) | `employerDocuments` | template *names* translated; template *bodies* left English (see decisions) |
| E-Signatures page (connection panel, envelope table/detail, OAuth error banners) | `employerEsign` | also owns shared `docTypes.*` and `status.*` enums |
| Send-document modal | `employerSendDocument` | used by Documents, E-Signatures, candidate drawer, shortlists |
| Send-copy control | `employerSendCopy` | |
| `LockedModuleBanner`, `FirstTouchSnackbar`, `QuotaBar`, `UpgradeCard`, tier names, server limit messages | `employerUi` (extended) | shared by every employer tab |
| Sidebar footer ("Free plan", "N of M sends used · Upgrade") | `employerNav` (extended) | |

257 new keys × 5 locales (en, zh, es, hi, fr).

### Tier-gating components (the "every free employer sees it on every page" part)
- `LockedModuleBanner` / `FirstTouchSnackbar`: sentence is now a rich-text message. New optional `featureKey` prop (`employeesHub`, `timesheets`, `careerSiteBuilder`, `timeOff`, `videoInterviews`, `shiftScheduling`) so callers don't need their own `t()`. The existing `feature` string prop still works (Office tools pass pre-translated names). 6 call sites switched to `featureKey`.
- `QuotaBar`: `label: string` → `kind: "jobs" | "seats" | "candidates" | "video" | "esign" | "documents"`. Each kind has a full-sentence message (limited and unlimited) so word order is correct per language ("已使用 0/3 次…"). 6 call sites updated (jobs, team, candidates, scheduler, docusign, documents).
- `UpgradeCard`: `/api/employer/upgrade-card` now also returns `tier`; the client renders the plan name and per-tier pitch from messages. `planLabel`/`pitch` are still returned as an English fallback.
- 402 `limit_reached` responses from `POST /api/employer/documents` and `POST /api/employer/docusign/send` now carry `kind`, `limit`, `tier`; `limitReachedMessage()` (`app/employer/components/limit-message.ts`) builds the sentence client-side. The English `error` string is unchanged for other consumers.

## Decisions to review
1. **Tier names stay as brand names** ("Portal", "Scale", "Corporate", "Employer Portal") in all locales; only "Free" is translated. Easy to flip in `employerUi.tierNames.*` if you want localized names.
2. **Document template bodies are not translated** (`lib/document-templates.ts`). They are legal/HR text a user then sends for signature; I did not want machine-authored legal wording shipped without review. Template *names* and the default "Untitled document" title are translated, so a zh user currently gets a Chinese title over an English body. Recommend a legal-reviewed pass, or hiding bodies until then.
3. **Other server error strings** (e.g. "Only the account owner can create documents", upload validation) are still English when the API returns them; the client shows `d.error` first and only falls back to a translated generic. Known codes (`not_connected`, `limit_reached`, OAuth errors) are fully translated. Proper fix = error codes across the API, out of scope here.
4. Dates now use the active locale (`toLocaleDateString(locale)`) instead of hard-coded `en-US`.

## Verification (all run on this branch)
- `tsc --noEmit`: clean
- `next lint`: no warnings or errors
- `next build`: succeeds
- Key parity en↔zh/es/hi/fr: 0 missing / 0 extra (full files, not just new namespaces)
- Placeholder/tag parity (`{var}`, `<strong>`, `<link>`) across locales: 0 mismatches
- Every static and dynamic `t()` key used in the touched files resolves in en.json
- All 1,390 messages in the touched namespaces formatted through `next-intl` `createTranslator` in all 5 locales: 0 ICU errors
- `t` shadowing: the loop params in `documents-client.tsx` (`tab` buttons, template list) and `send-document-modal.tsx` (doc-type options) were named `t` and are renamed (`key`, `tpl`, `dt`). Grep for remaining shadowing in touched files: none.
- Not verified: visual/browser rendering per locale (no Clerk/DB env in this sandbox), and native-speaker review of zh/es/hi/fr copy — translations are mine and should get a review pass.

## Update: earlier employer pages (#557, #558) merged
The "premise discrepancy" I first reported was wrong: those pages were translated in #557 (Messages/Jobs/Candidates/Shortlists) and #558 (Scheduler/Team/Career Site/Settings), which were unmerged drafts. Per your instruction both are now merged into `main`:
- **#557**: main (tier-gating) conflicted in `jobs-client.tsx` / `candidates-client.tsx` (both changed the component signature). Resolved by keeping main's new props (`activeLimit`, `pipelineLimit`) plus the translator. Merged.
- **#558**: conflicts in `messages/*.json` (resolved as the union; no overlapping keys differed) and in `career-site`, `scheduler`, `team` clients (kept main's `locked`/`seatLimit` props + translator). In the scheduler the tier hint now uses two new keys (`employerScheduler.recordingHint`, `.summariesHint`) instead of English literals. Merged.
- **This PR (#573)**: then merged main into it. Only the messages JSON conflicted (recursive union, no differing values), and I translated one English literal main added in `jobs-client.tsx` ("Could not update the job." -> `employerJobs.errorCouldNotUpdate`). `QuotaBar` now uses `kind` everywhere.
- Verification after each merge: `tsc`, `next lint`, `next build` all clean; key parity 0 missing/extra in all 5 locales. My parity script flags `employerShortlists.candidateCount` for zh only because it is an ICU `plural` (zh has no `one` branch) — expected.
- Leftover: `employerScheduler.videoInterviewsThisMonth` / `videoLimitPlan` are now unused (superseded by the `QuotaBar`); harmless, can be pruned.

## Note for the list (from review)
- Document template bodies (`lib/document-templates.ts`) intentionally stay English until a legal review; names are translated.

## Not done
PR 2 (employee portal, likely split in two), PR 3 (notification bell), PR 4 (public pages + custom auth copy), PR 5 (`my-resumes.tsx`, `documents-client.tsx` gap files — note the employee `documents-client.tsx` at `app/employee/(portal)/documents/` and the employer one I just translated share a filename; my-resumes.tsx (candidate side) is the gap file; employer documents-client.tsx is already covered here).
