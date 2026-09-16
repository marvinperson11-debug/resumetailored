# Video Interviews (Daily.co) — Build Report

Branch `claude/video-interviews` → **draft PR [#499](https://github.com/marvinperson11-debug/resumetailored/pull/499)** (base `main`). All changes under `resumetailored-platform/`. `tsc` / `next lint` / `next build` all green; **no new npm dependencies**.

## What shipped
Video interviews built on **Daily.co**, wired into the existing Scheduler.

- **`lib/daily.ts`** — server-only Daily REST client (raw fetch): create/delete room, recording download link, recording + transcript fetch, HMAC webhook verification, `rt-{id}` parsing. `DAILY_API_KEY` never reaches the client.
- **Scheduling hub:** scheduling a *video* interview auto-creates a Daily room (`rt-{interview_id}`, expires 24h after the end, cloud recording when the tier allows + the Record toggle is on), stores it on the row, and uses it as the join link. **Graceful degradation** — Daily unreachable/unconfigured ⇒ interview still created with a manual link + warning banner.
- **Emails (Resend):** candidate gets "Your interview for {position}" with a Join button + "no account needed" note; the scheduling host gets a confirmation with the same link. Cancel frees the room + emails the candidate.
- **Tier gating (`lib/employer-plan.ts`):** video/month — Free 0 (upgrade prompt), Portal 10, Scale 50, Corporate unlimited; recording + transcription Portal+; AI summary Scale+. Enforced at schedule time.
- **Webhook (`/api/daily/webhook`):** on `recording.ready`, archive recording + transcript to the private `interview-recordings` bucket, set status `completed`, and (Scale+) generate a structured AI summary (strengths / concerns / follow-ups / recommendation) via the existing Anthropic client. Optional HMAC via `DAILY_WEBHOOK_SECRET`.
- **Migration 0019 (idempotent):** `interviews` + `room_url`/`room_name`/`recording_url`/`transcript_url`/`ai_summary jsonb`/`record_enabled`; private `interview-recordings` bucket + owner storage policies.
- **UI:** Record-interview toggle (tier-gated, locked notes), Join button, Recording + Transcript download links (owner-scoped signed URLs), AI-summary block with recommendation badge, "Recording on" tag, monthly video-usage line, graceful-degradation banner.

## Files
- **New:** `lib/daily.ts`, `app/api/daily/webhook/route.ts`, `app/api/employer/interviews/[id]/recording/route.ts`, `supabase/migrations/0019_video_interviews.sql`
- **Changed:** `interviews/route.ts` (gating + room + emails), `interviews/[id]/route.ts` (room delete on cancel/delete), `scheduler/page.tsx` + `scheduler-client.tsx` (UI), `employer-collab-store.ts` (cols + room/media/count fns), `employer-notify.ts` (join emails), `employer-plan.ts` (video gating), `employer-ai.ts` (types + summary prompt), `.env.example`

## Quality gates
- `npx tsc --noEmit` ✅ · `next lint` ✅ · `next build` ✅ (all new routes + scheduler page compile)
- Room-name parse, webhook HMAC, video allowance, and summary normalization sanity-checked with a standalone script.
- No new npm dependencies; `whoami` stays removed.

## ⚠️ Manual steps for you (also in the PR description)
1. **Create a Daily account** (free tier) → add **`DAILY_API_KEY`** to Railway.
2. **Register the webhook** `https://app.resumetailored.com/api/daily/webhook` in the Daily dashboard (optionally set **`DAILY_WEBHOOK_SECRET`** in Railway to match).
3. **Run `supabase/migrations/0019_video_interviews.sql`** by hand (idempotent).
4. For transcript → AI summary, enable transcription (Deepgram) on the Daily domain; without it, recording still archives and the interview completes (summary skipped).

## Notes / decisions
- Rooms are `privacy: "public"` (anyone-with-link, max 2 participants) to honor "no account needed" for v1.
- Recording/transcript stored as private-bucket **paths**; the UI streams them through an owner-scoped signed-URL route.
- Transcription: I create rooms with **recording** only (reliable) and let the webhook pull whatever transcript the Daily domain emits — rather than passing an `enable_transcription` room property that can make room creation fail on accounts without Deepgram. Net effect matches the spec's intent (transcript+summary when the domain supports it) without risking the schedule flow. Flag if you'd rather force it as a room property.
- The webhook does download → upload → LLM inline before returning 200. Fine for v1 volume; if Daily retries become an issue at scale we can move it to a queue.

## Open question
- Want me to mark #499 ready and merge once CI is green (same as #495–#498)?
