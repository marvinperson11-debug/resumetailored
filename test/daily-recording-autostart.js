#!/usr/bin/env node
/**
 * Guards for the "Recording on but 0 recorded minutes" fix.
 *
 * Root cause: createRoom set enable_recording:'cloud' (which only PERMITS
 * recording) but nothing started it — a server-created public room has no
 * interactive Record click. Daily auto-starts cloud recording only via a
 * meeting token with start_cloud_recording:true. So recording never began.
 *
 * Source-level guards:
 *   1. createRoom logs the full request + response (auditable at schedule time).
 *   2. createMeetingToken mints a token with enable_recording:'cloud' +
 *      start_cloud_recording when asked.
 *   3. A host join route mints that token and redirects into the room.
 *   4. The Scheduler's Join button routes through the join route for our rooms.
 *
 * Usage: node test/daily-recording-autostart.js
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
const joinRoute = read('resumetailored-platform/app/api/employer/interviews/[id]/join/route.ts');
const client = read('resumetailored-platform/app/employer/scheduler/scheduler-client.tsx');

// ── 1. createRoom logs request + response ───────────────────────────────────
check('createRoom logs the request body',
  /console\.log\(["']\[daily\.createRoom\] request/.test(daily));
check('createRoom logs the response (what Daily accepted)',
  /console\.log\(["']\[daily\.createRoom\] response/.test(daily));

// ── 2. createMeetingToken auto-starts cloud recording ───────────────────────
check('createMeetingToken exists',
  /export async function createMeetingToken\(/.test(daily));
check('token sets enable_recording:cloud + start_cloud_recording',
  /properties\.enable_recording\s*=\s*["']cloud["']/.test(daily) &&
  /properties\.start_cloud_recording\s*=\s*true/.test(daily),
  'both are required for cloud recording to auto-start on join');
check('token posts to the meeting-tokens endpoint',
  /\/meeting-tokens/.test(daily));

// ── 3. Host join route mints the token and redirects ────────────────────────
check('join route mints a start_cloud_recording owner token',
  /createMeetingToken\(\{[^}]*startCloudRecording:\s*true/s.test(joinRoute) &&
  /isOwner:\s*true/.test(joinRoute));
check('join route redirects into the room',
  /NextResponse\.redirect\(/.test(joinRoute));

// ── 4. Scheduler Join routes through the join route for our rooms ────────────
check('Join button uses the server join route for Daily rooms',
  /const joinHref\s*=\s*i\.roomUrl\s*\?\s*`\/api\/employer\/interviews\/\$\{i\.id\}\/join`/.test(client) &&
  /href=\{joinHref\}/.test(client));

if (failures) {
  console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('\nALL PASS (0 failures)');
process.exit(0);
