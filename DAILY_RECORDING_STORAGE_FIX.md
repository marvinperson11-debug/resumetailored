# Recording archived: 413 EntityTooLarge → keep video in Daily's cloud

Branch `claude/daily-recording-storage` → **draft PR (link after push)**. `tsc`/`lint`/`build`/guard test all green; no new deps.

## What was wrong
The webhook pipeline worked end-to-end (`recording.ready-to-download` fired, download succeeded) but the **upload to Supabase Storage failed with 413 EntityTooLarge** — a ~100MB+ interview video exceeds Supabase's **50MB per-object** limit. Because the upload threw, the interview never reached `completed`.

## The fix (this PR) — exactly your 4 points
1. **Webhook stops uploading the video.** `app/api/daily/webhook/route.ts` no longer downloads + uploads the mp4. It stores **Daily's recording id** (`recording_id`) on the interview row instead. Small assets still archive to the `interview-recordings` bucket — and now behind a **10MB size guard** (`MAX_SUPABASE_ASSET_BYTES`) so nothing can 413 again. (Transcript is the only asset we fetch today; the guard covers audio/anything future.)
2. **New `GET /api/employer/interviews/[id]/recording-download`** (auth-gated, owner-scoped) — calls Daily's recording **access-link** endpoint for a **fresh** download URL each request and **302-redirects** to it. Fresh matters: raw Daily recording links expire, so a stored URL would rot. Legacy recordings that were archived to Supabase before this change still work (it falls back to a signed Supabase URL).
3. **Interview completes on the video alone.** The webhook sets `status = 'completed'` whenever the recording is ready, regardless of whether a transcript exists (transcription is best-effort / may be off on the domain). The Scheduler's **Recording** link now points at the new download route for Daily recordings.
4. **Cost note:** video recordings now live in **Daily's cloud storage** ($0.003/recorded-min storage — pennies at interview volume); **transcripts/audio still archive to Supabase** (small, free-tier).

## Files
- **Changed:** `app/api/daily/webhook/route.ts` (no video upload; store recording_id; size-guard; complete on video), `lib/employer-collab-store.ts` (`recording_id` in select/map + `updateInterviewMedia`), `lib/employer-ai.ts` (`Interview.recordingId`), `app/employer/scheduler/scheduler-client.tsx` (Recording link → download route)
- **New:** `app/api/employer/interviews/[id]/recording-download/route.ts`, `supabase/migrations/0022_interviews_recording_id.sql`, `test/daily-recording-storage.js`

## Manual step
Run **`supabase/migrations/0022_interviews_recording_id.sql`** on prod Supabase by hand (idempotent — `add column if not exists recording_id`).

## What to expect on your re-test
Schedule a **fresh** video interview (Record on) → click Join as the employer (recording auto-starts, from #507) → end the call. The webhook now:
- fetches the transcript if available (≤10MB → archived), skips the video upload,
- stores the Daily `recording_id`, sets status **completed**,
- and the Scheduler shows a **Recording** button that streams the video from Daily via a fresh link.

No 413, and status reaches `completed` even with no transcript.

## Quality gates
`tsc` ✅ · `lint` ✅ · `build` ✅ (recording-download route compiled) · `node test/daily-recording-storage.js` ✅ · no new deps.
