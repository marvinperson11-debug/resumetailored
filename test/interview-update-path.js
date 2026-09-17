#!/usr/bin/env node
/**
 * Guards for the "Reopen does nothing / room never persists" fix.
 *
 * Root cause: setInterviewRoom() and updateInterview() both write `updated_at`,
 * which is missing on the drifted live `interviews` table. Supabase returns the
 * error rather than throwing, and both fns did `return !error` WITHOUT logging —
 * so the room attach and every status change failed silently (reads still work
 * because the SELECT column list omits updated_at).
 *
 * Source-level guards:
 *   1. updateInterview + setInterviewRoom log the returned Supabase error.
 *   2. The Scheduler's patch()/del() surface a failure instead of silently
 *      reloading.
 *   3. Migration 0021 adds interviews.updated_at if missing.
 *
 * Usage: node test/interview-update-path.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const store = read('resumetailored-platform/lib/employer-collab-store.ts');
const client = read('resumetailored-platform/app/employer/scheduler/scheduler-client.tsx');
const mig = read('resumetailored-platform/supabase/migrations/0021_interviews_updated_at_heal.sql');

// ── 1. Returned Supabase errors are logged (no more silent write failures) ───
check('updateInterview logs the returned Supabase error',
  /if \(error\) console\.error\(["']\[updateInterview\] update failed/.test(store),
  'a returned {error} (e.g. missing updated_at) must be logged, not swallowed');

check('setInterviewRoom logs the returned Supabase error',
  /if \(error\) console\.error\(["']\[setInterviewRoom\] update failed/.test(store),
  'a failed room attach must be logged (room_url silently null otherwise)');

// ── 2. Frontend surfaces PATCH/DELETE failures ──────────────────────────────
check('patch() checks res.ok and surfaces a notice on failure',
  /async function patch\([\s\S]*?if \(!res\.ok\)[\s\S]*?setNotice\(/.test(client),
  'a failed PATCH must set a notice, not just reload silently');

check('del() checks res.ok and surfaces a notice on failure',
  /async function del\([\s\S]*?if \(!res\.ok\)[\s\S]*?setNotice\(/.test(client));

// ── 3. Heal migration adds updated_at if missing ────────────────────────────
check('migration 0021 adds interviews.updated_at if not exists',
  /alter table public\.interviews\s+add column if not exists updated_at timestamptz not null default now\(\)/i.test(mig));

if (failures) {
  console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('\nALL PASS (0 failures)');
process.exit(0);
