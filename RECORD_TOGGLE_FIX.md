# Record toggle not reaching createRoom — fix + instrumentation + guard

Branch `claude/record-toggle-fix` → **draft PR (link after push)**. `tsc`/`lint`/`build`/guard test all green; no deps, no migration.

## What the logs told us (and the deduction)
- `rt-16` was **created** (room exists) but its request had `enable_screenshare` and **no `enable_recording`**. Morning rooms `rt-7/rt-8` had `enable_recording:"cloud"`.
- Because the room **was created**, the route's tier gate passed — video is only allowed for a non-free tier, and `canRecord = tier !== free`, so at POST time `allowance.canRecord` was **true**. The route computes `recordEnabled = mode==='video' && b.recordEnabled && allowance.canRecord`. With `canRecord` true and the result false, **`b.recordEnabled` arrived false** → the flag was dropped **client-side**, before the POST.
- The drop point: the client body did `recordEnabled: mode === "video" && gating.canRecord ? recordEnabled : false` — it re-gated the toggle against **`gating.canRecord` captured at page render**. That page-load value comes from `getAccess()`, which can transiently fall back (slow Clerk / legacy entitlement call), so a stale/degraded page-load gating could zero the toggle at submit even though the account can record (as the room creation itself proves).

## The fix
1. **Client sends the raw toggle** (`app/employer/scheduler/scheduler-client.tsx`): `recordEnabled: mode === "video" ? recordEnabled : false` — no `&& gating.canRecord`. The **server is the authority**: the route still `&&`s with a **fresh** `allowance.canRecord`, so tier is enforced with current data and a stale page-load value can no longer silently drop recording.
2. **Route instrumentation** (`app/api/employer/interviews/route.ts`): `[interviews POST] record decision {mode, bodyRecordEnabled, canRecord, recordEnabled}` — shows exactly what the toggle sent vs. what was resolved. Combined with `[daily.createRoom] request` (which must show `enable_recording:"cloud"` when on) and the new `[daily.createRoom] response {requestedRecording, recordingEnabled, …}`, the whole path is now traceable from Railway.
3. **createRoom reports acceptance** (`lib/daily.ts`): returns `recordingEnabled` = `config.enable_recording === "cloud"` from Daily's response, and logs `requestedRecording` vs accepted.
4. **Guard** (route): if recording was requested but the created room lacks it (`recordEnabled && !room.recordingEnabled`), it now **logs an error and returns a warning** — "recording could not be enabled … the call will not be recorded" — instead of silently handing over a non-recordable room. The employer sees it at schedule time.

## Repro / verify after deploy
Schedule an interview with **Record ON** and watch Railway:
- `[interviews POST] record decision` → `bodyRecordEnabled:true, canRecord:true, recordEnabled:true`
- `[daily.createRoom] request` → `properties.enable_recording:"cloud"`
- `[daily.createRoom] response` → `recordingEnabled:true`

If `bodyRecordEnabled` is ever `false` with the toggle on, that's a remaining client issue the log now pinpoints; if `recordingEnabled` is false while requested, the guard warns immediately.

## Files
- Changed: `app/employer/scheduler/scheduler-client.tsx`, `app/api/employer/interviews/route.ts`, `lib/daily.ts`
- New: `test/record-toggle-fix.js`

## Quality gates
`tsc` ✅ · `lint` ✅ · `build` ✅ · `node test/record-toggle-fix.js` ✅ · no deps · no migration.
