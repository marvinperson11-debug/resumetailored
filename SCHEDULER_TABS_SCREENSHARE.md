# Scheduler tabs (status-based) + screenshare confirmation

Branch `claude/scheduler-tabs-screenshare-log` → **draft PR (link after push)**. `tsc`/`lint`/`build`/guard test all green; no deps, no migration.

## 1. Scheduler tabs are now status-based (date-agnostic)
The filter keyed Upcoming/Past off the scheduled time vs. now, so a **completed** interview whose scheduled slot was still in the future stayed under **Upcoming** — your exact case: scheduled Saturday, run and completed Friday, but it lingered in Upcoming.

Fixed in `app/employer/scheduler/scheduler-client.tsx`:
- **Upcoming** = `status === 'scheduled'`
- **Past** = `status === 'completed' || status === 'cancelled'`
- **All** = everything

Now completing an interview moves it to **Past immediately**, regardless of its scheduled date (and a not-yet-held interview stays in Upcoming even if its time has passed). Sort order unchanged (Upcoming soonest-first, Past most-recent-first). Removed the now-unused date-window logic.

## 2. Screenshare — confirmed on + explicitly logged
- `createRoom` **does** set `enable_screenshare: true` in `properties` (shipped in #510) — it's in the `[daily.createRoom] request` log.
- The `[daily.createRoom] response` log now **also surfaces it explicitly**: `enable_screenshare: <what Daily accepted>` (alongside the full `config`), so you can confirm at a glance from Railway that a newly created room has it.

**Screen sharing platform note (not a bug):**
- Only **newly created** rooms have `enable_screenshare` — rooms created before #510 deployed won't; schedule a fresh interview to get it.
- Screen sharing requires a **desktop browser** (Chrome / Edge / macOS Safari). **iOS/iPadOS Safari does not support `getDisplayMedia`**, so the Share control won't appear on iPhone/iPad — that's a platform limitation, not a bug.
- In Daily's prebuilt UI the Share control may live under the **"More" (⋯)** menu rather than the main toolbar.

## Files
- Changed: `app/employer/scheduler/scheduler-client.tsx`, `lib/daily.ts`
- New: `test/scheduler-tabs.js`

## Quality gates
`tsc` ✅ · `lint` ✅ · `build` ✅ · `node test/scheduler-tabs.js` ✅ · no deps · no migration.
