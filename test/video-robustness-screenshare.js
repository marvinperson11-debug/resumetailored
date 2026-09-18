#!/usr/bin/env node
/**
 * Guards for the video-interview robustness pass + screen sharing.
 *
 *   1. Auto-complete path is logged end-to-end and resilient:
 *      a. join route logs record-enabled decision + auto-record token outcome,
 *         and LOUDLY logs the silent-fallback (no-recording) case.
 *      b. createMeetingToken logs request + mint; webhook logs delivery+payload
 *         and the status-update result.
 *      c. updateInterviewMedia logs the returned error and retries without
 *         recording_id so status still flips to 'completed'.
 *      d. Scheduler refreshes on focus/visibility (no stale status).
 *   2. Screen sharing enabled on the room (+ owner token).
 *
 * Usage: node test/video-robustness-screenshare.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const daily = read('resumetailored-platform/lib/daily.ts');
const join = read('resumetailored-platform/app/api/employer/interviews/[id]/join/route.ts');
const webhook = read('resumetailored-platform/app/api/daily/webhook/route.ts');
const store = read('resumetailored-platform/lib/employer-collab-store.ts');
const client = read('resumetailored-platform/app/employer/scheduler/scheduler-client.tsx');

// ── 1a. Join route logging ──────────────────────────────────────────────────
check('join route logs the host-join decision',
  /console\.log\(["']\[interviews\/join\] host join/.test(join));
check('join route logs auto-record token attached',
  /console\.log\(["']\[interviews\/join\] auto-record token attached/.test(join));
check('join route LOUDLY logs the silent no-record fallback',
  /console\.error\(["']\[interviews\/join\] token mint FAILED/.test(join));

// ── 1b. Token + webhook logging ─────────────────────────────────────────────
check('createMeetingToken logs request + mint',
  /console\.log\(["']\[daily\.createMeetingToken\] request/.test(daily) &&
  /console\.log\(["']\[daily\.createMeetingToken\] minted/.test(daily));
check('webhook logs delivery + payload',
  /console\.log\(["']\[daily webhook\] received[\s\S]*payload/.test(webhook));
check('webhook logs the status-update result',
  /console\.log\(["']\[daily webhook\] interview updated/.test(webhook) &&
  /const updated = await updateInterviewMedia\(/.test(webhook));

// ── 1c. updateInterviewMedia: log + resilient retry ─────────────────────────
check('updateInterviewMedia logs the returned Supabase error',
  /console\.error\(["']\[updateInterviewMedia\] update failed/.test(store));
check('updateInterviewMedia retries without recording_id so status still completes',
  /"recording_id" in row/.test(store) &&
  /retried without recording_id/.test(store));

// ── 1d. Scheduler fresh status ──────────────────────────────────────────────
check('scheduler refreshes on focus/visibility',
  /addEventListener\(["']focus["'],\s*refresh\)/.test(client) &&
  /visibilitychange/.test(client));

// ── 2. Screen sharing ───────────────────────────────────────────────────────
check('room enables screenshare',
  /enable_screenshare:\s*true/.test(daily));
check('owner token carries screenshare',
  /if \(args\.isOwner\)\s*\{[\s\S]*enable_screenshare\s*=\s*true/.test(daily));

if (failures) {
  console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('\nALL PASS (0 failures)');
process.exit(0);
