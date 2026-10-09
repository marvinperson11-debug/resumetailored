#!/usr/bin/env node
/**
 * Owner email alerts: every completed purchase (all tiers) and every new account signup.
 *
 * Boots the real app and drives the real POST /webhook (signed Stripe events) and POST
 * /api/clerk-webhook (signed Svix events). Resend is replaced by a recording fetch, so this proves
 * the alert actually reaches the mail helper with the right recipient, sender, plan and amount —
 * once per purchase/signup — rather than testing a helper in isolation.
 *
 * Usage: node test/owner-alerts.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const STRIPE_SECRET = 'whsec_test_owner_alerts';
const CLERK_SECRET = 'whsec_' + Buffer.from('clerk-owner-alert-test-key').toString('base64');
const OWNER = 'owner@example.com';
process.env.STRIPE_WEBHOOK_SECRET = STRIPE_SECRET;
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.RESEND_API_KEY = 're_test_key';
process.env.OWNER_EMAIL = OWNER;
process.env.OWNER_ALERT_FROM = 'alerts@resumetailored.com';
delete process.env.OWNER_ALERTS;
delete process.env.GA4_API_SECRET;
delete process.env.CLERK_SECRET_KEY;
delete process.env.CLERK_WEBHOOK_SECRET;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-owner-alerts-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';

const sent = [];
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.resend.com/emails')) {
    sent.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ id: 'em_test' }) };
  }
  return realFetch(url, opts);
};

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const { app } = require('../server.js');
const { verifySvix, readUserCreated } = require('../clerk-webhook.js');
const flush = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const ownerMails = () => sent.filter((m) => [].concat(m.to).includes(OWNER));

let PORT;
function post(pathname, raw, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw), ...headers } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject); r.write(raw); r.end();
  });
}
const stripeEvent = (session) => {
  const payload = JSON.stringify({ id: 'evt_' + session.id, type: 'checkout.session.completed', data: { object: session } });
  return post('/webhook', payload, { 'Stripe-Signature': stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_SECRET }) });
};
const svixHeaders = (id, body, secret = CLERK_SECRET, ts = String(Math.floor(Date.now() / 1000))) => ({
  'svix-id': id, 'svix-timestamp': ts,
  'svix-signature': 'v1,' + crypto.createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${body}`).digest('base64')
});

const TIERS = [
  ['Pro monthly $19', { mode: 'subscription', amount_total: 1900, metadata: {} }, 'Pro Monthly', '$19.00'],
  ['Pro lifetime $129', { mode: 'payment', amount_total: 12900, metadata: { plan: 'lifetime' } }, 'Pro Lifetime', '$129.00'],
  ['Employer Portal $49', { mode: 'subscription', amount_total: 4900, metadata: { plan: 'employer', employerTier: 'pro' } }, 'Employer Portal', '$49.00'],
  ['Employer Scale $99', { mode: 'subscription', amount_total: 9900, metadata: { plan: 'employer', employerTier: 'scale' } }, 'Employer Scale', '$99.00'],
  ['Employer Corporate $299', { mode: 'subscription', amount_total: 29900, metadata: { plan: 'employer', employerTier: 'corporate' } }, 'Employer Corporate', '$299.00'],
];

const srv = app.listen(0, async () => {
  PORT = srv.address().port;
  try {
    // ── Pure: Svix verification ──
    const body = '{"type":"user.created","data":{}}';
    const h = svixHeaders('msg_1', body);
    const v = (over = {}) => verifySvix({ secret: CLERK_SECRET, id: 'msg_1', timestamp: h['svix-timestamp'], signatureHeader: h['svix-signature'], rawBody: body, ...over });
    check('svix: a correct signature verifies', v());
    check('svix: a tampered body is rejected', !v({ rawBody: body + ' ' }));
    check('svix: a wrong secret is rejected', !v({ secret: 'whsec_' + Buffer.from('other').toString('base64') }));
    check('svix: a stale timestamp is rejected', !v({ now: Date.now() + 10 * 60 * 1000 }));
    check('svix: a missing signature is rejected', !v({ signatureHeader: '' }));
    check('readUserCreated picks the primary email and a name',
      JSON.stringify(readUserCreated({ type: 'user.created', data: { id: 'user_1', primary_email_address_id: 'e2', first_name: 'Ada', last_name: 'L', email_addresses: [{ id: 'e1', email_address: 'old@x.com' }, { id: 'e2', email_address: 'Ada@X.com' }] } })) === JSON.stringify({ email: 'ada@x.com', name: 'Ada L', userId: 'user_1' }));
    check('readUserCreated ignores other event types', readUserCreated({ type: 'user.updated', data: {} }) === null);

    // ── Purchases: one owner alert per tier, right plan + amount, from the alerts sender ──
    let n = 0;
    for (const [label, over, planName, amount] of TIERS) {
      n++;
      const email = `buyer${n}@example.com`;
      const session = { id: `cs_test_alert_${n}`, payment_status: 'paid', currency: 'usd', customer: `cus_${n}`, customer_details: { email }, ...over, metadata: { email, ...over.metadata } };
      sent.length = 0;
      const res = await stripeEvent(session);
      await flush();
      const mails = ownerMails();
      check(`${label}: webhook → HTTP 200`, res.status === 200, `status=${res.status}`);
      check(`${label}: exactly ONE owner alert`, mails.length === 1, `got ${mails.length}`);
      const m = mails[0] || {};
      check(`${label}: subject names the plan and amount`, String(m.subject).includes(planName) && String(m.subject).includes(amount), m.subject);
      check(`${label}: body has the buyer's email and Stripe session id`, String(m.html).includes(email) && String(m.html).includes(session.id));
      check(`${label}: sent from the owner-alert sender`, /alerts@resumetailored\.com/.test(String(m.from)), m.from);

      // Stripe retries deliveries: the same session must not alert twice.
      sent.length = 0;
      await stripeEvent(session);
      await flush();
      check(`${label}: a replayed delivery does not alert again`, ownerMails().length === 0);
    }

    // A paid checkout with no email at all still alerts (it used to be skipped entirely).
    sent.length = 0;
    await stripeEvent({ id: 'cs_test_alert_noemail', mode: 'subscription', payment_status: 'paid', currency: 'usd', amount_total: 1900, metadata: {} });
    await flush();
    check('a paid checkout with no email still alerts the owner', ownerMails().length === 1);

    // An unpaid session is not a purchase.
    sent.length = 0;
    await stripeEvent({ id: 'cs_test_alert_unpaid', mode: 'subscription', payment_status: 'unpaid', currency: 'usd', amount_total: 1900, metadata: { email: 'x@example.com' } });
    await flush();
    check('an unpaid session does not alert as a purchase', ownerMails().filter((m) => /purchase/i.test(m.subject)).length === 0);

    // ── Signups via Clerk ──
    const evBody = JSON.stringify({ type: 'user.created', data: { id: 'user_new', primary_email_address_id: 'e1', first_name: 'New', last_name: 'Person', email_addresses: [{ id: 'e1', email_address: 'new.person@example.com' }] } });
    let r = await post('/api/clerk-webhook', evBody, svixHeaders('msg_signup_0', evBody));
    check('clerk webhook is inert (404) until CLERK_WEBHOOK_SECRET is set', r.status === 404, `status=${r.status}`);

    process.env.CLERK_WEBHOOK_SECRET = CLERK_SECRET;
    sent.length = 0;
    r = await post('/api/clerk-webhook', evBody, svixHeaders('msg_signup_1', evBody, 'whsec_' + Buffer.from('wrong').toString('base64')));
    await flush();
    check('clerk webhook: a bad signature → 400 and no alert', r.status === 400 && ownerMails().length === 0, `status=${r.status}`);

    r = await post('/api/clerk-webhook', evBody, svixHeaders('msg_signup_2', evBody));
    await flush();
    check('clerk webhook: a valid user.created → 200', r.status === 200, `status=${r.status}`);
    check('clerk webhook: exactly one "New signup" owner alert with the email', ownerMails().length === 1 && /New signup: new\.person@example\.com/.test(ownerMails()[0].subject), JSON.stringify(ownerMails().map((m) => m.subject)));

    sent.length = 0;
    await post('/api/clerk-webhook', evBody, svixHeaders('msg_signup_2', evBody));
    await flush();
    check('clerk webhook: a replayed delivery does not alert again', ownerMails().length === 0);

    sent.length = 0;
    const other = JSON.stringify({ type: 'user.updated', data: { id: 'u' } });
    r = await post('/api/clerk-webhook', other, svixHeaders('msg_other', other));
    await flush();
    check('clerk webhook: other event types are acknowledged without an alert', r.status === 200 && ownerMails().length === 0);

    // ── OWNER_ALERTS=off still silences everything ──
    process.env.OWNER_ALERTS = 'off';
    sent.length = 0;
    await stripeEvent({ id: 'cs_test_alert_off', mode: 'subscription', payment_status: 'paid', currency: 'usd', amount_total: 1900, customer_details: { email: 'off@example.com' }, metadata: { email: 'off@example.com' } });
    await flush();
    check('OWNER_ALERTS=off silences the purchase alert', ownerMails().length === 0);
    delete process.env.OWNER_ALERTS;
  } catch (e) {
    failures++; console.error('FAIL  unexpected error', e && e.stack || e);
  } finally {
    srv.close();
    console.log(failures ? `\nFAILED (${failures} failure${failures === 1 ? '' : 's'})` : '\nALL PASS (0 failures)');
    process.exit(failures ? 1 : 0);
  }
});
