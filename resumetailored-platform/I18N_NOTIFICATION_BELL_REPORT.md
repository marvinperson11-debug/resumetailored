# i18n PR 3 — Notification bell (employer + employee)

## What changed
- **Bell chrome** (`components/notification-bell.tsx`, shared by both shells): title/aria-label, "Mark all read", "Loading…", "You're all caught up", and relative times ("5m ago") now go through `notificationBell.*` and `Intl.RelativeTimeFormat` for the active locale.
- **Event text.** Titles were written to the database in English at event time, so translating only the component would leave the actual notifications English. Each event now also stores a structured `msg` (`{ key, params }`); the bell renders `notificationBell.events.<key>` in the viewer's language. 22 event templates × 5 locales, covering all 13 event types (training assigned/completed, messages both directions, announcements, time off requested/approved/declined, timesheet submitted/approved/declined, schedule published/shift changed/removed, cert expiring, invite accepted, feed post/comment).
- Dates, week ranges and shift times in params are stored as ISO / `HH:MM` and formatted for the viewer's locale in the bell — the timezone/locale of the *reader*, not of whoever triggered it.
- ~20 call sites (`app/api/**`, `lib/cert-cron.ts`) pass `msg` next to the existing English `title`, which remains as the fallback.
- Message *bodies* (chat text, feed post text) are user content and are not translated.
- `t` shadowing: the `const t = setInterval(...)` in the bell's poll effect renamed to `timer`.

## ⚠️ Needs a DB step (hand-applied migration)
`supabase/migrations/0041_activity_event_msg.sql` adds `activity_events.msg jsonb`. Migrations in this repo are hand-applied, so:
- The code is deploy-order safe: reads use `select *`, and an insert that fails because `msg` is missing is retried once without it, so **no notification is ever lost** if the code ships first.
- Until the migration is applied, new events are stored without `msg` and stay English. Existing rows (no `msg`) always show their stored English title — nothing is backfilled.
- Side effect: `insertEvents` now surfaces Supabase insert errors in the existing `console.error` (previously `await insert()` returned `{ error }` and ignored it silently).

## Verification
`tsc --noEmit` clean · `next lint` clean · key parity 0 missing/extra ×4 locales · placeholder parity OK · all 136 bell messages format in 5 locales with 0 ICU errors. Build run below. Not verified: a live Supabase round-trip (no DB in this sandbox) and in-browser rendering.
