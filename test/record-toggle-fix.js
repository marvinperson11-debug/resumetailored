#!/usr/bin/env node
/**
 * Guards for the "Record toggle not reaching createRoom" fix.
 *
 * rt-16 was created without enable_recording though the toggle was on. The room
 * was created (tier check passed server-side), so recordEnabled reached the
 * route as false — a client-side drop from re-gating the toggle against the
 * page-load gating.canRecord. Fix + instrument + guard:
 *   1. Client sends the raw toggle (server enforces tier), no page-load re-gate.
 *   2. Route logs the record decision (body vs resolved).
 *   3. createRoom reports recordingEnabled from Daily's accepted config + logs
 *      requestedRecording.
 *   4. Route guards: recording requested but room lacks it → warning, not silent.
 *
 * Usage: node test/record-toggle-fix.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const client = read('resumetailored-platform/app/employer/scheduler/scheduler-client.tsx');
const route = read('resumetailored-platform/app/api/employer/interviews/route.ts');
const daily = read('resumetailored-platform/lib/daily.ts');

// ── 1. Client no longer re-gates the toggle against page-load gating ────────
check('client sends the raw toggle value (no && gating.canRecord)',
  /recordEnabled:\s*mode === "video" \? recordEnabled : false/.test(client) &&
  !/recordEnabled:\s*mode === "video" && gating\.canRecord \? recordEnabled : false/.test(client));

// ── 2. Route logs the record decision ───────────────────────────────────────
check('route logs the record decision (body vs resolved)',
  /\[interviews POST\] record decision[\s\S]*bodyRecordEnabled[\s\S]*recordEnabled/.test(route));

// ── 3. createRoom reports + logs recording acceptance ───────────────────────
check('createRoom returns recordingEnabled from Daily config',
  /recordingEnabled\s*=\s*d\.config\?\.enable_recording === "cloud"/.test(daily) &&
  /return \{ url: d\.url, name: d\.name, recordingEnabled \}/.test(daily));
check('createRoom logs requestedRecording vs accepted',
  /requestedRecording:\s*args\.enableRecording/.test(daily));

// ── 4. Route guard: requested-but-not-enabled surfaces a warning ────────────
check('route warns when recording requested but room lacks it',
  /if \(recordEnabled && !room\.recordingEnabled\)/.test(route) &&
  /recording could not be enabled/i.test(route));

if (failures) {
  console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('\nALL PASS (0 failures)');
process.exit(0);
