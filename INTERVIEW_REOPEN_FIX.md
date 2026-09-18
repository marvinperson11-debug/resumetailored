# Reopen does nothing + why the room never showed Join — root cause

Branch `claude/interview-update-updated-at` → **draft PR (link after push)**. `tsc`/`lint`/`build`/guard test all green; no new deps.

Also: **PR #505 is merged** (`5a37ef0a`) — the Join-gating + status-default + status-heal (0020) fix.

## The real root cause (bigger than the status drift)

The live `interviews` table is **missing the `updated_at` column**, and that silently breaks **every write** to an interview:

- `setInterviewRoom()` (persists the Daily room) and `updateInterview()` (status changes: Reopen/Complete/Cancel) both set `updated_at`.
- The Supabase client **returns** a DB error rather than throwing, and both functions did `return !error` **without logging it** — so the failure was completely silent.
- The SELECT column list (`INT_COLS`) does **not** include `updated_at`, so **reads keep working** (you see the row) while every **write** that touches `updated_at` fails with `column "updated_at" does not exist`.

This single fact explains everything you saw:

| Observation | Explanation |
|---|---|
| Interview row lists fine | reads don't touch `updated_at` |
| Status is `pending` | `createInterview` insert doesn't set `updated_at`, so it succeeded — with the drifted default `pending` |
| **No Join button** | `setInterviewRoom` failed → **`room_url` was never saved (null)** → nothing to join |
| **Reopen does nothing** | `updateInterview` failed → status never changed; the UI reloaded and swallowed the error |

So the missing Join wasn't only the status gate (that was real too, fixed in #505) — on this row **there is no room at all**, because attaching it failed silently.

Why `updated_at` is missing: migration 0016 adds it via `add column if not exists`, but only if that ALTER block was applied to the live table — and this project applies migrations by hand. The 0019 video columns clearly *were* applied (reads of `room_url` work), but 0016's `updated_at` heal apparently wasn't.

## The fix (this PR)

1. **`lib/employer-collab-store.ts` — stop the silent failure.** `updateInterview()` and `setInterviewRoom()` now `console.error` the returned Supabase error (`[updateInterview] update failed …` / `[setInterviewRoom] update failed …`), so this class of drift is diagnosable instead of invisible.
2. **`app/employer/scheduler/scheduler-client.tsx` — surface it to you.** `patch()` and `del()` now check `res.ok` and show the existing notice banner on failure, instead of silently reloading ("page refreshed, nothing changed").
3. **`supabase/migrations/0021_interviews_updated_at_heal.sql` (idempotent, apply by hand)** — `add column if not exists updated_at …`. This is the actual repair; a no-op if the column already exists.

`test/interview-update-path.js` guards all three.

## What to run + expect (order matters)

You said you're running **0020** by hand — good, that backfills the row's status `pending → scheduled`. Also run **0021** (adds `updated_at`).

After **both** migrations + this deploy:
- **New** video interviews will schedule, persist the room, and show **Join** end-to-end.
- **Reopen / Complete / Cancel** will actually work (and any future write failure will show a banner + a server log line).

⚠️ **The existing test row still won't have a Join even after 0020+0021**, because its `room_url` was never saved (the attach failed before the column existed). **Fix it by deleting that row and scheduling a fresh video interview** — the new one will attach and show Join. (0020 only fixes its status; it can't recover a room that was never persisted.)

If anything still fails after 0021, click Reopen once and check the logs for `[updateInterview] update failed` / `[setInterviewRoom] update failed` — the new logging will name the exact column/constraint, and I'll chase it.

## Quality gates
`tsc` ✅ · `lint` ✅ · `build` ✅ · `node test/interview-update-path.js` ✅ · no new deps.
