# Video interview shows no Join button — diagnosis + fix

Branch `claude/video-interview-join-status` → **draft PR (link after push)**. `tsc` / `lint` / `build` / guard test all green; no new deps.

## Short answer

The Daily room was **created fine** — this is **not** a room-creation failure. The interview row has `status = 'pending'`, and the Scheduler only rendered **Join** when `status === 'scheduled'`. `'pending'` isn't even a valid interview status in this codebase — it's **schema drift on the live `interviews` table** (its `status` column still defaults to `'pending'` from an older schema, and the create flow relied on that DB default). So a perfectly good, room-backed interview showed Reopen instead of Join.

## Your three questions

### 1. Why no Join? Was the room created?
**The room was created — room_url is populated, not null.** Evidence from prod (active deploy `dd227e04`):
- `lib/daily.ts:createRoom()` logs `console.error("[daily.createRoom]", …)` on **any** failure. There are **zero `[daily.*]` error lines** on the deployment. No failure occurred.
- `createInterview()` logs `[createInterview] insert failed/threw` on failure — **none present**. The insert succeeded.

So the schedule flow worked; the room exists. The Join button was hidden purely because of the **status value**:
- `POST /api/employer/interviews` never sets `status`, so the **DB column default** decides it.
- The repo's migration (0016) defines `status ... default 'scheduled' check (status in ('scheduled','completed','cancelled'))`. But the **live** table defaults to `'pending'` and lacks that CHECK (if the CHECK were present, inserting `'pending'` would have *failed* — it didn't, so it's drift). This is the same "live table created before the canonical migration" pattern we already hit with a missing column in #497.
- `INTERVIEW_STATUSES = ["scheduled","completed","cancelled"]` — `'pending'` is out of vocabulary, so the UI's `STATUS_TONE['pending']` is undefined and, critically, `Join` (gated on `status === 'scheduled'`) never rendered.

You're right that a silent room-less fallback *would* be a bug — but that's not what happened here. The room is there; the status is wrong.

### 2. Reopen vs Join — does Reopen create a room?
- **Join** is just an `<a href={roomUrl}>` that opens the Daily room in a new tab. It creates nothing.
- **Reopen** calls `PATCH /api/employer/interviews/:id` with `{status:'scheduled'}` — it only flips the status back to `scheduled`. It does **not** create or refresh a room.
- Useful side effect: on your existing `'pending'` row, clicking **Reopen** flips it to `scheduled`, and because `room_url` already exists, **Join then appears immediately** — a one-click workaround while the fix deploys.

### 3. Does Join only render for `scheduled`? Should `pending` with a room still show Join?
Yes, it did only render for `scheduled` (`{isLink && i.status === "scheduled" && …}`) — and yes, that's too strict. **Fixed:** Join now renders for any **non-terminal** interview that has a room (`isLink && isActive`, where `isActive = status !== 'completed' && status !== 'cancelled'`), so a room-backed row always offers Join regardless of an unexpected status.

## The fix (three parts, defense-in-depth)

1. **`lib/employer-collab-store.ts` — `createInterview` sets `status: 'scheduled'` explicitly** on insert, so scheduling never depends on the drifted DB default. Fixes all **new** interviews immediately, even before the DB is healed. (A caller-supplied status still wins.)
2. **`app/employer/scheduler/scheduler-client.tsx` — Join gate broadened** from `status === 'scheduled'` to `isLink && isActive`. Room-backed rows always show Join; resilient to any future status drift.
3. **`supabase/migrations/0020_interviews_status_heal.sql` (idempotent, apply by hand)** — backfills any non-canonical status (`'pending'`, NULL) to `'scheduled'`, sets the column default to `'scheduled'`, and reinstalls the canonical CHECK so `'pending'` can never recur. This corrects the **existing** row and the root drift.

`test/interview-join-status.js` guards all three.

## What you'll see after deploy
- **New** video interviews schedule as `scheduled` and show **Join** right away.
- Your **existing** `pending` row: either click **Reopen** now (instant — flips to scheduled, Join appears), or run migration 0020 (backfills it to scheduled and shows Join). After 0020, Reopen isn't needed.

## Manual step
Run **`supabase/migrations/0020_interviews_status_heal.sql`** against the production Supabase DB by hand (this project applies migrations manually). It's idempotent and safe to re-run.

## Quality gates
`npx tsc --noEmit` ✅ · `next lint` ✅ · `next build` ✅ · `node test/interview-join-status.js` ✅ · no new deps.
