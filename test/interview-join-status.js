#!/usr/bin/env node
/**
 * Guards for the "video interview has no Join button" fix.
 *
 * Root cause: a drifted live `interviews` table defaults status to 'pending',
 * and the create flow relied on that DB default; the Scheduler only rendered
 * Join for status === 'scheduled', so a room-backed interview showed no Join.
 *
 * Source-level guards (the Next app can't boot in the plain-node root loop):
 *   1. createInterview sets status: 'scheduled' explicitly on insert (does not
 *      trust the DB default).
 *   2. The Scheduler renders Join for any non-terminal interview with a room,
 *      not only status === 'scheduled'.
 *   3. Migration 0020 backfills non-canonical statuses and reinstalls the CHECK.
 *
 * Usage: node test/interview-join-status.js
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
const mig = read('resumetailored-platform/supabase/migrations/0020_interviews_status_heal.sql');

// ── 1. createInterview writes an explicit status ────────────────────────────
check('createInterview sets status: "scheduled" explicitly on insert',
  /\.insert\(\{[^}]*status:\s*["']scheduled["'][^}]*\}/s.test(store) ||
  /status:\s*["']scheduled["'],\s*\.\.\.interviewRow/.test(store),
  'the insert must not rely on the DB column default (drifted to "pending")');

// ── 2. Join is not gated solely on status === "scheduled" ───────────────────
check('scheduler computes an isActive (non-terminal) flag',
  /const\s+isActive\s*=\s*i\.status\s*!==\s*["']completed["']\s*&&\s*i\.status\s*!==\s*["']cancelled["']/.test(client),
  'Join should key off a non-terminal flag, not the exact "scheduled" string');

check('Join renders for a room-backed active interview, not only "scheduled"',
  /\{isLink\s*&&\s*isActive\s*&&\s*\(/.test(client) &&
  !/\{isLink\s*&&\s*i\.status\s*===\s*["']scheduled["']\s*&&\s*\(/.test(client),
  'the Join <a> gate must be `isLink && isActive`, not `isLink && status === "scheduled"`');

// ── 3. Heal migration ───────────────────────────────────────────────────────
check('migration 0020 backfills non-canonical statuses to scheduled',
  /update\s+public\.interviews[\s\S]*set\s+status\s*=\s*'scheduled'[\s\S]*not in \('scheduled', 'completed', 'cancelled'\)/i.test(mig));

check('migration 0020 reinstalls the canonical status CHECK',
  /drop constraint if exists interviews_status_check/i.test(mig) &&
  /add constraint\s+interviews_status_check[\s\S]*check \(status in \('scheduled', 'completed', 'cancelled'\)\)/i.test(mig));

if (failures) {
  console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('\nALL PASS (0 failures)');
process.exit(0);
