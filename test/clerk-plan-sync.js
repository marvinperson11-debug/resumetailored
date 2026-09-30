#!/usr/bin/env node
/**
 * _syncPlanToClerk — never patch the wrong Clerk account.
 *
 * Regression test for a live incident: `GET /v1/users?email_address=...`
 * (bare, non-array param) is not a filter Clerk's Backend API recognizes, so
 * it silently returned its default, UNFILTERED, newest-first user list. The
 * old code trusted `users[0]` — whichever Clerk account had most recently
 * signed up, completely unrelated to the buyer — and PATCHed the real
 * buyer's plan onto it. A brand-new candidate account picked up
 * `plan:'employer', tier:'corporate'` with zero user action this way.
 *
 * Drives the real POST /webhook path (checkout.session.completed → an
 * individual Pro purchase) with a mocked global.fetch standing in for
 * api.clerk.com, so this proves the actual code path, not just the helper
 * in isolation. The mock deliberately puts a same-shaped DECOY user first in
 * the returned list (mirroring what Clerk's default unfiltered order would
 * hand back) to prove the fix selects by matching email, not by index 0.
 *
 * Usage: node test/clerk-plan-sync.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const WEBHOOK_SECRET = 'whsec_test_secret_for_clerk_sync';
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.CLERK_SECRET_KEY = 'sk_test_clerk_dummy';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-clerk-sync-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';

// ── Mock global.fetch: pass real requests through, intercept api.clerk.com ──
const BUYER_EMAIL = 'buyer2@example.com';
const DECOY_USER = { id: 'user_decoy_freshly_signed_up', email_addresses: [{ email_address: 'random-candidate@example.com' }] };
const REAL_BUYER_USER = { id: 'user_real_buyer', email_addresses: [{ email_address: BUYER_EMAIL }] };

const calls = { lookups: [], patches: [] };
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://api.clerk.com/v1/users?')) {
    calls.lookups.push(u);
    // Simulate Clerk's real, unfiltered, newest-first default list — the
    // decoy (most recently created, unrelated account) sorts before the
    // actual buyer, exactly like the live incident.
    const body = JSON.stringify([DECOY_USER, REAL_BUYER_USER]);
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  }
  if (u.startsWith('https://api.clerk.com/v1/users/') && opts && opts.method === 'PATCH') {
    calls.patches.push({ url: u, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({}) };
  }
  return realFetch(url, opts);
};

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const { app } = require('../server.js');
const Database = require('better-sqlite3');
const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));

function post(rawBody, sigHeader) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(rawBody) };
    if (sigHeader !== null) headers['Stripe-Signature'] = sigHeader;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/webhook', method: 'POST', headers }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', c => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject);
    r.write(rawBody);
    r.end();
  });
}

function signed(eventObj) {
  const payload = JSON.stringify(eventObj);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, header };
}

// _syncPlanToClerk is fire-and-forget (unawaited by the webhook handler), so
// give its two chained fetches a few event-loop turns to land.
function flush(ms = 50) { return new Promise((r) => setTimeout(r, ms)); }

let PORT;
const srv = app.listen(0, async () => {
  PORT = srv.address().port;
  try {
    const ev = {
      id: 'evt_clerk_sync_1', type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_test_clerk_sync_1', mode: 'subscription', customer: 'cus_real_buyer',
        metadata: { email: BUYER_EMAIL }, customer_details: { email: BUYER_EMAIL }
      } }
    };
    const { payload, header } = signed(ev);
    const res = await post(payload, header);
    check('checkout.session.completed → HTTP 200', res.status === 200, `status=${res.status} body=${res.body}`);
    await flush();

    check('Clerk user lookup was made', calls.lookups.length === 1, JSON.stringify(calls.lookups));
    check('lookup uses the array query param Clerk actually recognizes (email_address[]=)',
      calls.lookups[0] && calls.lookups[0].includes('email_address[]='),
      calls.lookups[0]);

    check('exactly one metadata patch was sent (not one per candidate in the list)',
      calls.patches.length === 1, JSON.stringify(calls.patches));
    check('the patch targeted the REAL buyer\'s Clerk user id, not the decoy (index 0)',
      calls.patches[0] && calls.patches[0].url === `https://api.clerk.com/v1/users/${REAL_BUYER_USER.id}/metadata`,
      calls.patches[0] && calls.patches[0].url);
    check('the decoy (unrelated, most-recently-created) account was never touched',
      !calls.patches.some(p => p.url.includes(DECOY_USER.id)), JSON.stringify(calls.patches));
    check('the patched metadata reflects the real buyer\'s plan',
      calls.patches[0] && calls.patches[0].body.public_metadata.plan === 'pro',
      calls.patches[0] && JSON.stringify(calls.patches[0].body));

    // ── No match in the returned list → no patch at all (not even to index 0) ──
    calls.lookups.length = 0; calls.patches.length = 0;
    const noMatchEmail = 'no-clerk-account-yet@example.com';
    const ev2 = {
      id: 'evt_clerk_sync_2', type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_test_clerk_sync_2', mode: 'subscription', customer: 'cus_no_match',
        metadata: { email: noMatchEmail }, customer_details: { email: noMatchEmail }
      } }
    };
    const { payload: p2, header: h2 } = signed(ev2);
    const res2 = await post(p2, h2);
    check('second checkout.session.completed → HTTP 200', res2.status === 200, `status=${res2.status}`);
    await flush();
    check('no Clerk account matches the buyer email → no metadata patch sent (never falls back to index 0)',
      calls.patches.length === 0, JSON.stringify(calls.patches));
  } catch (e) {
    failures++;
    console.error('FAIL  unexpected error —', e && e.stack || e);
  } finally {
    global.fetch = realFetch;
    srv.close();
    db.close();
    if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
    else console.log('\nALL PASS');
  }
});
