#!/usr/bin/env node
/**
 * Guards for the Daily webhook register route hardening (fix for the production
 * Cloudflare 502 host error on GET /api/employer/daily/register-webhook?do=1).
 *
 * The route lives in the Next.js app (resumetailored-platform/), which the plain
 * root test loop can't boot (no Clerk/Supabase env, no Next runtime). So these
 * are source-level guards — they lock in the defensive properties that stop the
 * route from HANGING (which is what surfaced as a 502 host error, not a 524
 * timeout) or CRASHING the worker:
 *
 *   1. Every Daily control-plane fetch has a short, shared timeout — no fetch
 *      can hang past the Cloudflare→origin window. The old 15000ms value is
 *      gone; all control-plane calls use DAILY_TIMEOUT_MS.
 *   2. The whole handler is wrapped so a thrown error becomes JSON, never a
 *      crashed worker: GET and POST route through `safe()`, and auth resolution
 *      is caught (a Clerk throw → 403, not an unhandled rejection).
 *   3. A Daily timeout/unreachable resolves to app-owned JSON (503), not a bare
 *      502 that reads like a host error.
 *   4. The ?do=1 GET path (iPad, no console) is actually present in the source
 *      that ships in the build.
 *
 * A live-curl CI job (boot the route, curl it, expect 401/403) is deliberately
 * NOT added here: the root CI runs plain `node test/*.js` and never boots Next,
 * and standing up the Next server would need Clerk/Supabase env and a port —
 * flaky and heavy for what a source guard proves just as well. The route is
 * verified to return JSON (not 502) against production after deploy instead.
 *
 * Usage: node test/daily-webhook-route.js
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
const route = read('resumetailored-platform/app/api/employer/daily/register-webhook/route.ts');

// ── 1. Every control-plane fetch has a short shared timeout ──────────────────
check('daily.ts declares a shared control-plane timeout',
  /const\s+DAILY_TIMEOUT_MS\s*=\s*8000\b/.test(daily),
  'DAILY_TIMEOUT_MS = 8000 must be declared');

check('daily.ts has no leftover 15000ms timeout',
  !daily.includes('15000'),
  'a 15s timeout can exceed the Cloudflare→origin window — use DAILY_TIMEOUT_MS');

// Each control-plane fetch (rooms, recordings, transcript metadata, webhooks)
// must carry a signal built from the shared constant.
const timeoutSignals = (daily.match(/AbortSignal\.timeout\(DAILY_TIMEOUT_MS\)/g) || []).length;
check('daily.ts wires DAILY_TIMEOUT_MS into every control-plane fetch',
  timeoutSignals >= 8,
  `expected >= 8 AbortSignal.timeout(DAILY_TIMEOUT_MS), found ${timeoutSignals}`);

// The webhook list/create calls the route depends on must have the timeout.
check('listWebhooks() is timeout-guarded',
  /export async function listWebhooks[\s\S]*?AbortSignal\.timeout\(DAILY_TIMEOUT_MS\)/.test(daily));
check('createWebhook() is timeout-guarded',
  /export async function createWebhook[\s\S]*?AbortSignal\.timeout\(DAILY_TIMEOUT_MS\)/.test(daily));

// ── 2. The handler cannot crash the worker ───────────────────────────────────
check('route exports GET and POST',
  /export async function GET\b/.test(route) && /export async function POST\b/.test(route));

check('route wraps handlers in a safe() try/catch → JSON 500',
  /async function safe\(/.test(route) &&
  /return safe\(async/.test(route) &&
  /catch\s*\([\s\S]*?status:\s*500/.test(route),
  'GET/POST must route through safe(); a thrown error must become JSON 500');

check('auth resolution is caught (a Clerk throw → 403, not an unhandled throw)',
  /try\s*\{[\s\S]*?employerContext\(\)[\s\S]*?\}\s*catch[\s\S]*?status:\s*403/.test(route),
  'employerContext() must be wrapped so a throw returns 403, not a crash');

check('route caps its own duration under the host window',
  /export const maxDuration\s*=\s*\d+/.test(route));

// ── 3. Daily unreachable → app-owned JSON, not a bare 502 ────────────────────
check('a Daily timeout/unreachable returns JSON 503 (not a host 502)',
  /function dailyUnreachable\(\)[\s\S]*?status:\s*503/.test(route) &&
  /listWebhooks\(\)/.test(route) &&
  /===\s*null[\s\S]*?dailyUnreachable\(\)/.test(route),
  'listWebhooks() === null must map to dailyUnreachable() (503 JSON)');

// ── 4. The ?do=1 GET path (iPad, no console) is present ──────────────────────
check('GET ?do=1 registers (iPad-friendly path is in the shipped source)',
  /searchParams\.get\(["']do["']\)\s*===\s*["']1["']/.test(route) &&
  /function register\(/.test(route),
  'GET must handle ?do=1 by calling register()');

if (failures) {
  console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('\nALL PASS (0 failures)');
process.exit(0);
