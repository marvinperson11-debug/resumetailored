# Activity feed translation + language dropdown stacking (PR #584)

## Bug 1 — Employer Dashboard "Recent activity" stayed English

### Diagnosis
- The feed is **not** read from `activity_events`. `getDashboard()` in `lib/employer-store.ts` builds it on every request from `applicants`, `jobs`, `team_members` and `acknowledgments`, and it was producing finished English sentences ("New applicant for {job}", "{n}% match", "Closes {date}", "Training overdue: …").
- Migration 0041 (`activity_events.msg jsonb`) is therefore **unrelated to this feed**. It serves the notification **bell**, which already stores `{key, params}` and translates at render (`notificationBell.events.*`). The write path (`logActivityFor*` → `insertEvents`) already stores `msg`, and tolerates the column being absent. I did not verify that 0041 has been applied to your production database (no DB access from this session) — it still needs hand-applying if not done; until then new bell events stay English. This does not affect the dashboard feed.
- No stored text is involved for the feed, so **no backfill and no fallback for old rows** is needed.

### Fix
- `ActivityEntry` is now structured: `{ kind, event, params, date }` (`event` ∈ applicant / expiring / teamJoined / trainingSigned / trainingOverdue). Only user-entered values (job title, person name, email, doc title) travel in `params`; unknown values are `null`.
- New `lib/dashboard-activity.ts` (`describeActivity`) turns an entry into text using `employerDashboard.activity.*`, added to all 5 locales.
- Dates ("Closes", "due") go through `Intl` via next-intl's formatter (UTC, so a bare `YYYY-MM-DD` cannot slide a day). The match score is an ICU argument; nothing is concatenated.
- Missing names/titles fall back to translated placeholders ("a role", "a document", "an employee") instead of the English literals or the string "undefined".

### Verification
The sandbox has no Supabase, so the live feed is empty there. I rendered real entries through the real `messages/*.json` with next-intl's translator and formatter (zero missing-message/format errors):

| | applicant | expiring | overdue (fallbacks) |
|---|---|---|---|
| zh | Senior Nurse 有新申请人 · Jane Doe · 匹配度 87% | 职位即将到期：Cook · 截止 2026年10月2日 | 培训已逾期：某份文档 · 某位员工 · 截止 2026年9月28日 |
| es | Nuevo candidato para Senior Nurse · Jane Doe · 87% de coincidencia | La oferta vence pronto: Cook · Cierra el 2 oct 2026 | Capacitación vencida: un documento · un empleado · vence el 28 sept 2026 |
| hi | Senior Nurse के लिए नया आवेदक · Jane Doe · 87% मिलान | जॉब पोस्टिंग जल्द समाप्त हो रही है: Cook · अंतिम तिथि 2 अक्टू॰ 2026 | प्रशिक्षण की समय-सीमा बीत गई: एक दस्तावेज़ · एक कर्मचारी · देय 28 सित॰ 2026 |
| fr | Nouveau candidat pour Senior Nurse · Jane Doe · 87 % de correspondance | L'offre expire bientôt : Cook · Clôture le 2 oct. 2026 | Formation en retard : un document · un employé · échéance le 28 sept. 2026 |

Job titles, names and emails stay in their original language, as intended.

**Not verified:** the feed in a live browser with real employer data (no Supabase/Clerk access here). The page code path is a thin wrapper over the function tested above.

## Bug 2 — Language dropdown rendered behind the stat cards

### Root cause
`DashboardShell`'s header is `relative` with `backdrop-blur`, which makes it its own stacking context at `z-index: auto`. The dropdown's `z-20` therefore only ranks *inside* the header. Positioned / backdrop-filtered cards later in `<main>` (the `.glass` stat cards) paint after the header and cover the menu.

### Fix
`components/dashboard-shell.tsx`: header gets `z-40` (below the `z-50` mobile drawer and modals). This is the single shell used by candidate, employer **and** employee portals, and the notification bell and profile menus live in the same header, so all of them are fixed together.

### Verification (real browser, Playwright/Chromium)
- Reproduced on the **original** build: in Chinese the menu renders partly behind the cards — 中文, Español and हिन्दी faded out under the card glass.
- **Fixed build, Chinese and Hindi, desktop (1440px) and phone (390px):** menu fully opaque and above the cards in all cases (screenshots reviewed).
- My first automated check used `elementFromPoint`, which reported "on top" even on the broken build — it does not reflect painting here, so I discarded it and judged by screenshots.

**Not verified directly: the employer and employee pages.** Without a signed-in employer account (Clerk/Supabase unreachable from the sandbox) those routes show the "employer account required" gate instead of the shell. They use the identical `DashboardShell` header, so the fix applies, but I have not seen it render there. Worth a 10-second look when you test.

## Checks
- `tsc --noEmit`, `next lint`, `lint:i18n` (0 findings) and message parity (2828 keys × 5 locales) pass locally; CI `platform` and `test` green on the PR.
- No Stripe code touched.
