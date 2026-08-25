#!/usr/bin/env node
/**
 * Stripe webhook — signature + resilience integration.
 *
 * Boots the real Express app against a throwaway SQLite DB and drives POST
 * /webhook with genuinely Stripe-signed payloads (via the stripe library's own
 * generateTestHeaderString, so verification is real — no network, no real
 * account). Proves the two contracts Stripe depends on:
 *
 *   1. A valid signature on a well-formed event returns 200 and is processed
 *      (checkout.session.completed inserts the subscriber).
 *   2. A missing / bad signature returns 400 (the ONLY non-2xx case) — a
 *      request that may not be from Stripe is rejected.
 *   3. A valid signature whose PROCESSING throws still returns 200. This is the
 *      regression that produced the backlog of failed deliveries: an
 *      unhandled throw used to escape to the Express error handler → HTTP 500 →
 *      Stripe marks the delivery failed and retries for days. We force a real
 *      throw (better-sqlite3 rejects a non-bindable param) and assert 200.
 *   4. The raw-body parser is mounted so req.body reaches constructEvent as a
 *      Buffer (source assertion: express.raw on /webhook precedes express.json).
 *
 * Usage: node test/stripe-webhook.js
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

const WEBHOOK_SECRET = 'whsec_test_secret_for_regression';
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
// constructEvent / generateTestHeaderString only need the library, not a live
// key, but the app constructs `new Stripe(process.env.STRIPE_SECRET_KEY)` at
// boot — give it a syntactically fine dummy so nothing warns/crashes.
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-wh-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const { app } = require('../server.js');
const Database = require('better-sqlite3');
const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));

// Source-level guard for contract #4: raw body parser mounted before json.
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const rawIdx = server.indexOf("express.raw({ type: 'application/json' })");
const jsonIdx = server.search ? server.indexOf('app.use(express.json())') : -1;
check('express.raw on /webhook is mounted before express.json()',
  rawIdx > -1 && jsonIdx > -1 && rawIdx < jsonIdx,
  `rawIdx=${rawIdx} jsonIdx=${jsonIdx}`);

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

// Build a raw JSON event payload + a valid signature over EXACTLY those bytes.
function signed(eventObj) {
  const payload = JSON.stringify(eventObj);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, header };
}

let PORT;
server_listen();
function server_listen() {
  const srv = app.listen(0, async () => {
    PORT = srv.address().port;
    try {
      // ── 1. Valid signature, well-formed checkout.session.completed → 200 + processed
      {
        const email = 'buyer@example.com';
        const ev = {
          id: 'evt_ok_1', type: 'checkout.session.completed',
          data: { object: {
            id: 'cs_test_ok_1', mode: 'subscription', customer: 'cus_ok_1',
            metadata: { email }, customer_details: { email }
          } }
        };
        const { payload, header } = signed(ev);
        const res = await post(payload, header);
        check('valid checkout.session.completed → HTTP 200', res.status === 200, `status=${res.status} body=${res.body}`);
        const row = db.prepare('SELECT email FROM subscribers WHERE email = ?').get(email);
        check('valid checkout.session.completed processed (subscriber inserted)', !!row, JSON.stringify(row));
      }

      // ── 2a. Missing signature → 400
      {
        const { payload } = signed({ id: 'evt_nosig', type: 'checkout.session.completed', data: { object: {} } });
        const res = await post(payload, null);
        check('missing Stripe-Signature → HTTP 400', res.status === 400, `status=${res.status}`);
      }
      // ── 2b. Bad signature → 400
      {
        const { payload } = signed({ id: 'evt_badsig', type: 'checkout.session.completed', data: { object: {} } });
        const res = await post(payload, 't=1,v1=deadbeef');
        check('invalid Stripe-Signature → HTTP 400', res.status === 400, `status=${res.status}`);
      }
      // ── 2c. Tampered body (signature no longer matches payload) → 400
      {
        const { header } = signed({ id: 'evt_tamper', type: 'checkout.session.completed', data: { object: {} } });
        const res = await post(JSON.stringify({ id: 'evt_tamper', type: 'checkout.session.completed', data: { object: { customer: 'injected' } } }), header);
        check('tampered body (signature mismatch) → HTTP 400', res.status === 400, `status=${res.status}`);
      }

      // ── 3. Valid signature but processing THROWS → still 200.
      // `customer` as an object makes better-sqlite3's bound .get() throw a real
      // TypeError inside the handler. Before the try/catch fix this escaped to
      // the Express error handler and returned 500 (Stripe: failed delivery).
      {
        const ev = {
          id: 'evt_throw_1', type: 'customer.subscription.deleted',
          data: { object: { customer: { not: 'a-string' } } }
        };
        const { payload, header } = signed(ev);
        const res = await post(payload, header);
        check('handler throw on valid event → still HTTP 200', res.status === 200, `status=${res.status} body=${res.body}`);
        check('handler throw response acknowledges receipt', /received/.test(res.body), res.body);
      }

      // ── 3b. A second throwing event type, to be sure it is the wrapper, not luck.
      {
        const ev = {
          id: 'evt_throw_2', type: 'invoice.payment_failed',
          data: { object: { customer: { still: 'not-a-string' } } }
        };
        const { payload, header } = signed(ev);
        const res = await post(payload, header);
        check('second throwing event → still HTTP 200', res.status === 200, `status=${res.status}`);
      }

      // ── 4. An unhandled event type is a clean 200 no-op.
      {
        const ev = { id: 'evt_unknown', type: 'payment_intent.succeeded', data: { object: {} } };
        const { payload, header } = signed(ev);
        const res = await post(payload, header);
        check('unhandled event type → HTTP 200 no-op', res.status === 200, `status=${res.status}`);
      }
    } catch (e) {
      failures++;
      console.error('FAIL  unexpected error —', e && e.stack || e);
    } finally {
      srv.close();
      db.close();
      if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
      else console.log('\nALL PASS');
    }
  });
}
