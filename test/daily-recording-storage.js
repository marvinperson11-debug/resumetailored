#!/usr/bin/env node
/**
 * Guards for "recording video stays in Daily, not Supabase" (413 EntityTooLarge fix).
 *
 * A 2-min interview video is ~100MB+, over Supabase Storage's 50MB per-object
 * limit → the webhook upload 413'd and the interview never completed. Now the
 * video stays in Daily's cloud (store recording_id), only small assets archive
 * to Supabase, and a download route fetches a fresh Daily URL on demand.
 *
 * Source-level guards:
 *   1. Webhook no longer uploads the video; stores recording_id + completes.
 *   2. Small assets are size-guarded before any Supabase upload.
 *   3. recording-download route fetches a fresh Daily link and redirects.
 *   4. Store + type carry recordingId; migration 0022 adds the column.
 *   5. Scheduler recording link points at the download route for Daily recordings.
 *
 * Usage: node test/daily-recording-storage.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const webhook = read('resumetailored-platform/app/api/daily/webhook/route.ts');
const dlRoute = read('resumetailored-platform/app/api/employer/interviews/[id]/recording-download/route.ts');
const store = read('resumetailored-platform/lib/employer-collab-store.ts');
const ai = read('resumetailored-platform/lib/employer-ai.ts');
const mig = read('resumetailored-platform/supabase/migrations/0022_interviews_recording_id.sql');
const client = read('resumetailored-platform/app/employer/scheduler/scheduler-client.tsx');

// ── 1. Webhook stops uploading video, stores recording_id, completes ────────
check('webhook no longer uploads the video (no video/mp4 upload)',
  !/video\/mp4/.test(webhook) && !/recording\.mp4/.test(webhook),
  'the ~100MB video must not be uploaded to Supabase');
check('webhook stores Daily recording id and completes the interview',
  /recordingId:\s*dailyRecordingId/.test(webhook) &&
  /status:\s*["']completed["']/.test(webhook));

// ── 2. Size guard for small Supabase assets ─────────────────────────────────
check('webhook size-guards Supabase uploads',
  /MAX_SUPABASE_ASSET_BYTES/.test(webhook) &&
  /buf\.length\s*<=\s*MAX_SUPABASE_ASSET_BYTES/.test(webhook));

// ── 3. Fresh-link download route ────────────────────────────────────────────
check('recording-download route fetches a fresh Daily link and redirects',
  /getRecordingDownloadLink\(iv\.recordingId\)/.test(dlRoute) &&
  /NextResponse\.redirect\(/.test(dlRoute) &&
  /requireEmployerId/.test(dlRoute));

// ── 4. Data model carries recordingId ───────────────────────────────────────
check('Interview type has recordingId',
  /recordingId:\s*string/.test(ai));
check('store selects + maps recording_id and updateInterviewMedia writes it',
  /recording_id/.test(store) &&
  /recordingId:\s*\(r\.recording_id/.test(store) &&
  /row\.recording_id\s*=\s*patch\.recordingId/.test(store));
check('migration 0022 adds interviews.recording_id',
  /add column if not exists recording_id text/i.test(mig));

// ── 5. Scheduler points recording link at the download route ────────────────
check('scheduler recording link uses recording-download for Daily recordings',
  /i\.recordingId\s*\?\s*`\/api\/employer\/interviews\/\$\{i\.id\}\/recording-download`/.test(client) &&
  /\(i\.recordingId\s*\|\|\s*i\.recordingUrl\)/.test(client));

if (failures) {
  console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('\nALL PASS (0 failures)');
process.exit(0);
