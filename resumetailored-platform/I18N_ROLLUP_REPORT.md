# i18n remaining-surfaces — rollup (all 5 PRs)

All PRs are **draft**, each verified with `tsc --noEmit`, `next lint`, `next build`, 0 missing/extra keys across en/zh/es/hi/fr, placeholder/tag parity, and a formatting pass of every new message through `next-intl` in all 5 locales. None were verified in a browser or by a native speaker.

## Merged first (your instruction)
- **#557** (Messages/Jobs/Candidates/Shortlists) and **#558** (Scheduler/Team/Career Site/Settings) — merged to `main`. Both conflicted with the tier-gating PRs (#570–572) in the client files (resolved by keeping main's new props + the translator); #558 also conflicted on `messages/*.json` (resolved as the union, no overlapping values). One English literal added by main ("Could not update the job.") was translated in #573; the scheduler tier hints got two new keys.

## The 5 PRs

| # | PR | Scope | Keys ×5 |
|---|---|---|---|
| 1 | [#573](https://github.com/marvinperson11-debug/resumetailored/pull/573) | Employer Documents + E-Signatures + send modal + tier-gating copy (LockedModuleBanner, FirstTouchSnackbar, QuotaBar, UpgradeCard, sidebar plan footer, limit-reached messages) | 258 |
| 2a | [#574](https://github.com/marvinperson11-debug/resumetailored/pull/574) | Employee portal: Home, My schedule, My hours, Time off, My documents, Messages (+ access gate, time clock) | 116 |
| 2b | [#575](https://github.com/marvinperson11-debug/resumetailored/pull/575) | Employee portal: Feed, My training (incl. quiz), Library, Profile — **stacked on #574** | 97 |
| 3 | [#576](https://github.com/marvinperson11-debug/resumetailored/pull/576) | Notification bell (employer + employee) incl. event text | 28 |
| 4a | [#577](https://github.com/marvinperson11-debug/resumetailored/pull/577) | `/jobs`, job detail + apply form, `/careers/[slug]`, `/site/[slug]` 404 | 75 |
| 4b | [#578](https://github.com/marvinperson11-debug/resumetailored/pull/578) | `/sign/[id]`, `/join`, sign-in/up copy, `/employee/accept`, PWA install | 81 |
| 5 | [#579](https://github.com/marvinperson11-debug/resumetailored/pull/579) | Candidate `my-resumes.tsx` | 17 |

Per-PR detail is in `I18N_*_REPORT.md` on each branch.

## Before you merge — things that need you
1. **#576 needs a hand-applied migration:** `supabase/migrations/0041_activity_event_msg.sql` (`activity_events.msg jsonb`). Code is deploy-order safe (insert retries without the column; reads use `select *`), so nothing is lost if code ships first — but until applied, new notifications stay English. Existing rows are never translated (no backfill).
2. **Every PR appends top-level namespaces to `messages/*.json`, so merging them in sequence will conflict.** It is additive each time; resolve as a union and re-run the parity check. Order suggestion: #573 → #574 → #575 (retargets to main) → #576 → #577 → #578 → #579. I can resolve them as each merges (I did this for #557/#558).
3. **Translations are mine.** They need a native-speaker pass (zh/es/hi/fr), especially the legal-adjacent strings (limit/upgrade messages, signer page, invite flow).

## Decisions / notes for your list
- **Tier names stay as brand names** ("Portal", "Scale", "Corporate", "Employer Portal"); only "Free" is translated. *(approved)*
- **Document template bodies are NOT machine-translated** (legal text needs review); template names/titles are. **→ Open item: legal-reviewed translations of `lib/document-templates.ts`.** *(approved)*
- **Server error strings stay English** with a translated client fallback until API error codes exist. Known codes (limit reached, not connected, OAuth errors) are translated. **→ Open item: API error codes.** *(approved)* Same applies to Clerk's own error messages in the custom invite flow.
- **Locale-aware dates/times** everywhere touched. The employee portal uses a new `app/employee/components/format.ts`; `lib/time-hub.ts` (English; feeds CSV + employer tabs) is untouched.
- **Not translated by design (user/third-party content):** announcements, feed posts, chat text, job descriptions, company bios, personal-site HTML, and the ~80 government training-library titles/content (official English sources — translating titles without content would mislead). **→ Open item: decide on localized training content.**
- Durations still render as "2h 30m" in every language.
- Public pages follow the **visitor's** locale; the employer's career-site preview uses the **employer's** UI locale.
- Unused leftover keys: `employerScheduler.videoInterviewsThisMonth` / `videoLimitPlan` (superseded by `QuotaBar`).
- Employee **Settings** page is not in your list and is untouched.
- `t` shadowing fixed wherever found: documents-client, send-document-modal, schedule-client, library-client, career-site-view, notification-bell, both auth pages.

## Verification gaps (honest list)
No browser/per-locale rendering check (no Clerk/DB env in the sandbox), no live Supabase round-trip for #576, no real Clerk sign-up/sign-in round trip for #578, no native-speaker review.
