#!/usr/bin/env node
/**
 * Guards for the Scheduler tab fix + screenshare log.
 *
 *   1. Tabs are status-based (date-agnostic): Upcoming = scheduled,
 *      Past = completed|cancelled, All = everything. A completed interview whose
 *      scheduled time is still in the future must NOT show under Upcoming.
 *   2. createRoom sets enable_screenshare and logs it explicitly.
 *
 * Usage: node test/scheduler-tabs.js
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
const daily = read('resumetailored-platform/lib/daily.ts');

// ── 1. Status-based tabs ────────────────────────────────────────────────────
check('Upcoming = status scheduled (not date-based)',
  /view === "upcoming"\)\s*return i\.status === "scheduled"/.test(client));
check('Past = completed or cancelled',
  /view === "past"\)\s*return i\.status === "completed" \|\| i\.status === "cancelled"/.test(client));
check('filter no longer keys Upcoming/Past off scheduledAt vs now',
  !/t >= now - 60 \* 60 \* 1000/.test(client) && !/t < now - 60 \* 60 \* 1000/.test(client),
  'the date-window filter must be gone');

// ── 2. Screenshare on + logged ──────────────────────────────────────────────
check('createRoom sets enable_screenshare:true',
  /enable_screenshare:\s*true/.test(daily));
check('createRoom response log surfaces enable_screenshare explicitly',
  /\[daily\.createRoom\] response[\s\S]*enable_screenshare:\s*d\.config\?\.enable_screenshare/.test(daily));

if (failures) {
  console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('\nALL PASS (0 failures)');
process.exit(0);
