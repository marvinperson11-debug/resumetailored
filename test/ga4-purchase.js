#!/usr/bin/env node
/** GA4 server-side purchase: payload shape, paid-only, dedupe, retry-after-failure, webhook wiring. */
const fs = require('fs'), path = require('path');
const Database = require('better-sqlite3');
const { buildPurchasePayload, trackPurchase } = require('../ga4-purchase');
let failures = 0;
const check = (n, c, d) => { if (c) console.log('PASS  ' + n); else { failures++; console.error('FAIL  ' + n + (d ? ' — ' + d : '')); } };
(async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE usage_store (key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0)');
  const base = { id: 'cs_test_1', payment_status: 'paid', amount_total: 1900, currency: 'usd', mode: 'subscription', customer: 'cus_1', created: 1760000000, metadata: {} };
  const p = buildPurchasePayload(base).events[0];
  check('event name is purchase', p.name === 'purchase');
  check('value/currency/transaction_id', p.params.value === 19 && p.params.currency === 'USD' && p.params.transaction_id === 'cs_test_1');
  check('lifetime plan item', buildPurchasePayload({ ...base, mode: 'payment', amount_total: 12900 }).events[0].params.items[0].item_id === 'pro_lifetime');
  check('employer plan item', buildPurchasePayload({ ...base, amount_total: 9900, metadata: { plan: 'employer', tier: 'scale' } }).events[0].params.items[0].item_id === 'employer_scale');
  check('unpaid → null', buildPurchasePayload({ ...base, payment_status: 'unpaid' }) === null);

  const calls = []; const ok = async (u, o) => { calls.push({ u, o }); return { status: 204 }; };
  const env = { GA4_API_SECRET: 'sek' };
  check('unconfigured is inert', (await trackPurchase(base, { db, env: {}, fetchImpl: ok })).reason === 'unconfigured' && !calls.length);
  const r1 = await trackPurchase(base, { db, env, fetchImpl: ok });
  check('first call sends', r1.sent && calls.length === 1 && /measurement_id=G-JWC76X5X68&api_secret=sek/.test(calls[0].u));
  const r2 = await trackPurchase(base, { db, env, fetchImpl: ok });
  check('replayed webhook does not double-fire', !r2.sent && r2.reason === 'duplicate' && calls.length === 1);
  const bad = { ...base, id: 'cs_test_2' };
  const r3 = await trackPurchase(bad, { db, env, fetchImpl: async () => ({ status: 500 }), log: { error() {} } });
  check('failed send releases claim', !r3.sent && r3.reason === 'send_failed');
  check('retry after failure lands', (await trackPurchase(bad, { db, env, fetchImpl: ok })).sent);
  const r4 = await trackPurchase(bad, { db, env, fetchImpl: async () => { throw new Error('boom'); }, log: { error() {} } });
  check('never throws', r4.sent === false);

  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const wh = server.slice(server.indexOf("if (event.type === 'checkout.session.completed')"));
  check('wired into checkout.session.completed', wh.indexOf('trackGa4Purchase(session') > -1 && wh.indexOf('trackGa4Purchase(session') < wh.indexOf("event.type === 'customer.subscription.deleted'"));
  console.log(failures ? failures + ' FAILURE(S)' : 'ALL PASS'); process.exit(failures ? 1 : 0);
})();
