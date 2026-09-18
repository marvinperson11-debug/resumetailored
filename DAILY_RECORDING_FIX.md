# Video interview recorded 0 minutes — root cause + fix

Branch `claude/daily-recording-autostart` → **draft PR (link after push)**. `tsc`/`lint`/`build`/guard test all green; no new deps.

## Answers to your three questions

### 1. Do we pass `enable_recording:'cloud'` (and transcription) at room creation?
- **`enable_recording`: yes.** `createRoom()` sets `properties.enable_recording = "cloud"` when Record is on. Confirmed.
- **Transcription: no.** We deliberately don't pass `enable_transcription` (a prior decision — forcing it can make room creation fail on domains without Deepgram; the webhook pulls a transcript if the domain emits one).
- **But `enable_recording:'cloud'` only *permits* recording — it does not start it.** That's the bug (see #3).
- **Logging added** (your request): `createRoom()` now logs the full request and the response Daily returned:
  - `[daily.createRoom] request {"name":"rt-5","privacy":"public","properties":{…,"enable_recording":"cloud"}}`
  - `[daily.createRoom] response {"name":"rt-5","url":"…","config":{…"enable_recording":"cloud"}}`
  So next schedule you can see exactly what Daily accepted.

### 2. Does cloud recording need a paid plan beyond the $15 credit?
**No — recording works on the free tier; this was not a billing block.** From Daily's pricing:
- Free tier: **10,000 free participant minutes/month** ([pricing](https://www.daily.co/pricing/video-sdk/)).
- **Cloud recording: $0.01349 per recorded minute**, plus **$0.003/min storage** ([pricing](https://www.daily.co/pricing/video-sdk/), [recording guide](https://docs.daily.co/guides/products/live-streaming-recording/recording-calls-with-the-daily-api)). Audio-only is $0.005/min.
- No plan upgrade or dashboard toggle is required to *use* recording; charges just apply per recorded minute (a 2-minute interview recording ≈ **$0.03** + storage). Your account showing 0 recording minutes is consistent with recording **never starting**, not with it being blocked.

**Cheapest path: none needed — stay on pay-as-you-go.** At interview volumes this is cents. No upgrade to recommend.

### 3. Why didn't it record? (it should, at your tier)
**Recording was enabled but never *started*.** Daily's model:
- `enable_recording:'cloud'` on the room = recording is *allowed*.
- To actually begin, someone/something must start it: an interactive **Record** click in the prebuilt UI (only owners see it), a client `startRecording()` call, or — the automatic path — a **meeting token** with **`start_cloud_recording: true`** ([docs](https://docs.daily.co/guides/products/live-streaming-recording/recording-calls-with-the-daily-api)).

Our rooms are **public and tokenless**: the employer and candidate both join via the bare room URL, so nobody is an owner, no Record button is shown, and we never call a start API. `rt-5` ran clean (2 participants, 0% loss) but **nothing ever triggered recording → 0 minutes.** Not a property-name typo, not pricing — a missing start trigger.

## The fix (this PR)

1. **`lib/daily.ts`**
   - `createRoom()` logs request + response (above).
   - New **`createMeetingToken()`** — mints a room token; with `startCloudRecording:true` it sets **`enable_recording:'cloud'` + `start_cloud_recording:true`** (both required) via `POST /meeting-tokens`.
2. **New route `GET /api/employer/interviews/[id]/join`** — auth-gated (employer session). For a recording-enabled interview it mints an **owner token with `start_cloud_recording`** and **302-redirects** into the room, so **cloud recording auto-starts the instant the host joins**. Falls back to the plain room URL if token minting fails (still joins, logs why).
3. **Scheduler Join button** now points at that join route for our Daily rooms (`/api/employer/interviews/{id}/join`). The **candidate is unchanged** — they still join via the emailed room URL; the host's token starts recording and it covers the whole session.

`test/daily-recording-autostart.js` guards all of it.

## What to expect after deploy
Schedule a **new** video interview with Record on, then click **Join** (as the employer) — recording auto-starts on host join. After the call, `recording.ready-to-download` fires the webhook (already wired) → the recording archives to the private bucket and appears on the interview. The schedule-time logs will also show the exact room config Daily accepted.

Notes:
- The **existing `rt-5`** session can't be recorded retroactively — this only affects new/rejoined sessions.
- Recording starts when the **host** clicks Join. If only the candidate ever joins, it won't record (by design — the host attends interviews). Say the word if you'd rather also tokenize the candidate link.
- Requires the earlier interview fixes to be live (PR #505/#506 + migrations 0020/0021) so rooms attach and the row behaves.

## Quality gates
`tsc` ✅ · `lint` ✅ · `build` ✅ (join route compiled) · `node test/daily-recording-autostart.js` ✅ · no new deps.
