/* career-cron.js — in-process scheduler for the Career Hub's two daily jobs.
 *
 * WHY IN-PROCESS (and not a standalone Railway cron service):
 *   Both jobs need the app's SQLite database — warm-career-cache.js WRITES the
 *   quiz/interview/scenario caches, job-digest.js READS check_ins for opted-in
 *   users. That DB is a local file under DATA_DIR (a Railway Volume in prod),
 *   and a Railway Volume can only attach to ONE service. A separate cron
 *   service is a separate container with its own filesystem, so it would talk
 *   to an empty DB — the digest would email nobody and the warm cache would be
 *   thrown away. Running the jobs INSIDE the web service (spawned as child
 *   processes, which share the container's filesystem + volume) is the only
 *   thing that actually reaches the real database. If the app ever moves to a
 *   networked DB (Postgres), standalone cron services become viable — see
 *   docs/RAILWAY_CRON.md.
 *
 * Off by default. Set CAREER_CRON=on in the web service's env to activate — so
 * merging this never silently starts spending Anthropic credits or sending
 * email until you decide to. Times are UTC (CAREER_WARM_HOUR_UTC default 07:00,
 * CAREER_DIGEST_HOUR_UTC default 13:00). Only runs in the main web process,
 * never under tests. */
'use strict';

const path = require('path');
const { spawn } = require('child_process');

const running = {}; // file -> true while a run is in flight (no overlap)

function runScript(file) {
  if (running[file]) { console.log(`[career-cron] ${file} still running — skipping this tick`); return; }
  running[file] = true;
  console.log(`[career-cron] starting ${file} at ${new Date().toISOString()}`);
  const child = spawn(process.execPath, [path.join(__dirname, 'scripts', file)], {
    stdio: 'inherit', env: process.env
  });
  child.on('exit', (code) => { running[file] = false; console.log(`[career-cron] ${file} exited with code ${code}`); });
  child.on('error', (err) => { running[file] = false; console.error(`[career-cron] ${file} failed to start:`, err.message); });
}

// ms from now until the next daily HH:MM UTC.
function msUntil(hourUTC, minuteUTC, now) {
  const d = now || new Date();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUTC, minuteUTC, 0, 0));
  if (next.getTime() <= d.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - d.getTime();
}

function scheduleDaily(hourUTC, minuteUTC, file) {
  const tick = () => { runScript(file); setTimeout(tick, 24 * 60 * 60 * 1000); };
  const wait = msUntil(hourUTC, minuteUTC);
  setTimeout(tick, wait);
  return wait;
}

// ms from now until the next weekly occurrence of dayOfWeek (0=Sun..6=Sat) at HH:MM UTC.
function msUntilWeekly(dayOfWeekUTC, hourUTC, minuteUTC, now) {
  const d = now || new Date();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUTC, minuteUTC, 0, 0));
  let delta = (dayOfWeekUTC - next.getUTCDay() + 7) % 7;
  next.setUTCDate(next.getUTCDate() + delta);
  if (next.getTime() <= d.getTime()) next.setUTCDate(next.getUTCDate() + 7);
  return next.getTime() - d.getTime();
}

function scheduleWeekly(dayOfWeekUTC, hourUTC, minuteUTC, file) {
  const tick = () => { runScript(file); setTimeout(tick, 7 * 24 * 60 * 60 * 1000); };
  const wait = msUntilWeekly(dayOfWeekUTC, hourUTC, minuteUTC);
  setTimeout(tick, wait);
  return wait;
}

// Runs once shortly after boot (so a fresh deploy doesn't wait a full
// interval for its first data), then every intervalMs after that.
function scheduleEvery(intervalMs, file, initialDelayMs) {
  const tick = () => { runScript(file); setTimeout(tick, intervalMs); };
  const wait = initialDelayMs == null ? intervalMs : initialDelayMs;
  setTimeout(tick, wait);
  return wait;
}

function startCareerCron(log) {
  const say = log || console.log;
  if ((process.env.CAREER_CRON || 'off') !== 'on') { say('[career-cron] disabled (set CAREER_CRON=on to enable)'); return false; }
  const warmH = clampHour(process.env.CAREER_WARM_HOUR_UTC, 7);
  const digestH = clampHour(process.env.CAREER_DIGEST_HOUR_UTC, 13);
  scheduleDaily(warmH, 0, 'warm-career-cache.js');
  scheduleDaily(digestH, 0, 'job-digest.js');
  const feedIntervalH = clampInterval(process.env.JOB_FEED_REFRESH_HOURS, 6);
  scheduleEvery(feedIntervalH * 60 * 60 * 1000, 'refresh-job-feed.js', 2 * 60 * 1000);
  // Weekly Job Search Report — Pro-only Monday digest (day 1 UTC).
  const weeklyH = clampHour(process.env.WEEKLY_REPORT_HOUR_UTC, 13);
  scheduleWeekly(1, weeklyH, 0, 'weekly-report.js');
  say(`[career-cron] enabled — warm @ ${pad(warmH)}:00 UTC (npm run career:warm), digest @ ${pad(digestH)}:00 UTC (npm run career:job-digest), job feed every ${feedIntervalH}h (npm run career:job-feed), weekly report Mon @ ${pad(weeklyH)}:00 UTC (npm run career:weekly-report)`);
  return true;
}

function clampHour(v, dflt) { const n = parseInt(v, 10); return Number.isInteger(n) && n >= 0 && n <= 23 ? n : dflt; }
function clampInterval(v, dflt) { const n = parseInt(v, 10); return Number.isInteger(n) && n >= 1 && n <= 24 ? n : dflt; }
function pad(n) { return String(n).padStart(2, '0'); }

module.exports = { startCareerCron, msUntil, msUntilWeekly, scheduleDaily, scheduleWeekly, scheduleEvery };
