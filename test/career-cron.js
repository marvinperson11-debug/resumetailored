#!/usr/bin/env node
/**
 * Career Hub cron scheduler (career-cron.js) — pure timing logic + the
 * default-off safety gate. No child processes are spawned here.
 *
 * Usage: node test/career-cron.js
 */
const cron = require('../career-cron.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// msUntil: next occurrence of HH:MM UTC.
const at = (iso) => new Date(iso);
const HOUR = 3600 * 1000;
check('msUntil is later today when the time has not passed',
  cron.msUntil(13, 0, at('2026-08-03T09:00:00Z')) === 4 * HOUR,
  String(cron.msUntil(13, 0, at('2026-08-03T09:00:00Z'))));
check('msUntil rolls to tomorrow when the time has passed',
  cron.msUntil(7, 0, at('2026-08-03T09:00:00Z')) === 22 * HOUR,
  String(cron.msUntil(7, 0, at('2026-08-03T09:00:00Z'))));
check('msUntil at exactly the target rolls a full day (never 0)',
  cron.msUntil(7, 0, at('2026-08-03T07:00:00Z')) === 24 * HOUR);
check('msUntil handles a UTC day boundary',
  cron.msUntil(1, 0, at('2026-08-03T23:30:00Z')) === 1.5 * HOUR);

// Default-off gate: startCareerCron returns false and schedules nothing unless
// CAREER_CRON=on. (No timers are created in the off case.)
delete process.env.CAREER_CRON;
const logs = [];
check('scheduler is OFF by default', cron.startCareerCron((m) => logs.push(m)) === false);
check('off state is logged', logs.some((m) => /disabled/.test(m)));

process.env.CAREER_CRON = 'on';
const logs2 = [];
const started = cron.startCareerCron((m) => logs2.push(m));
check('scheduler is ON when CAREER_CRON=on', started === true);
check('on state names both jobs', logs2.some((m) => /warm/.test(m) && /digest/.test(m)));
check('on state also names the job feed refresh', logs2.some((m) => /job feed/.test(m)));
// Clean up the timers scheduleDaily created so the test process can exit.
delete process.env.CAREER_CRON;

// scheduleEvery: runs once after the initial delay, then every intervalMs.
check('scheduleEvery is exported', typeof cron.scheduleEvery === 'function');

if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
process.exit(0);
