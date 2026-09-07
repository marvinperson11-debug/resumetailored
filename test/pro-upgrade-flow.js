#!/usr/bin/env node
'use strict';
/**
 * Sign-up-first Pro upgrade flow (old-site half).
 *
 * The marketing site no longer initiates Stripe checkout for the consumer Pro
 * plan: its Pro/lifetime CTAs send the visitor to the dashboard app
 * (?upgrade=pro), which signs them in first and then calls the shared-secret
 * /api/app-checkout endpoint here to mint the Stripe session for their known
 * email. Employer plans still check out on-site.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let failures = 0;
const check = (name, ok, detail) => { if (ok) console.log('PASS ', name); else { failures++; console.error('FAIL ', name, detail ? '— ' + detail : ''); } };

// ── Static: the marketing site never initiates Stripe checkout ────────────────
// The on-site paid-checkout.js client has been removed entirely; every Pro,
// lifetime, and employer CTA now links straight to the dashboard app.
check('paid-checkout.js has been removed from the repo', !fs.existsSync(path.join(root, 'public/paid-checkout.js')));

// ── Static: the marketing homepage no longer carries consumer checkout code ───
const home = read('public/index.html');
check('homepage removed the email checkout modals + submit/checkout functions',
  !/id="checkoutModal"/.test(home) && !/id="lifetimeModal"/.test(home) &&
  !/function submitCheckout/.test(home) && !/function submitLifetime/.test(home) &&
  !/function openCheckoutModal/.test(home) && !/openCheckoutModal\(\)/.test(home));
check('homepage Pro CTAs link directly to the app upgrade flow',
  home.includes("location.href='https://app.resumetailored.com?upgrade=pro'"));
check('homepage nav: Free Tools → app, Pro Tools → app?upgrade=pro',
  /href="https:\/\/app\.resumetailored\.com"[^>]*data-i18n="nav_free_tools"/.test(home) &&
  /href="https:\/\/app\.resumetailored\.com\?upgrade=pro"[^>]*data-i18n="nav_pro_tools"/.test(home));

// ── Runtime: /api/app-checkout is a shared-secret endpoint ────────────────────
const SECRET = 'test-entitlement-secret';
process.env.ENTITLEMENT_SYNC_SECRET = SECRET;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-proflow-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');

function req(method, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const h = Object.assign({}, headers);
    if (payload) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(payload); }
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers: h }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', (c) => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} resolve({ status: res.statusCode, json: j, body: b }); });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

let PORT;
const server = app.listen(0, async () => {
  PORT = server.address().port;
  try {
    const noAuth = await req('POST', '/api/app-checkout', {}, { email: 'a@b.com' });
    check('rejects a request with no bearer secret (401)', noAuth.status === 401, `HTTP ${noAuth.status}`);

    const badAuth = await req('POST', '/api/app-checkout', { Authorization: 'Bearer wrong' }, { email: 'a@b.com' });
    check('rejects a wrong bearer secret (401)', badAuth.status === 401, `HTTP ${badAuth.status}`);

    const noEmail = await req('POST', '/api/app-checkout', { Authorization: `Bearer ${SECRET}` }, {});
    check('requires an email even when authorized (400)', noEmail.status === 400, `HTTP ${noEmail.status}`);
    // With a valid secret + email the route reaches Stripe; without keys in CI
    // that surfaces as a 500 (never a 401/400/404) — proving auth + validation
    // passed and only the Stripe call remains.
    const authed = await req('POST', '/api/app-checkout', { Authorization: `Bearer ${SECRET}` }, { email: 'buyer@example.com', returnUrl: 'https://evil.example/x' });
    check('authorized request with email passes gating (not 401/400/404)', ![401, 400, 404].includes(authed.status), `HTTP ${authed.status}`);

    const lifetime = await req('POST', '/api/app-checkout', { Authorization: `Bearer ${SECRET}` }, { email: 'buyer@example.com', plan: 'lifetime' });
    check('lifetime plan passes gating (not 401/400/404)', ![401, 400, 404].includes(lifetime.status), `HTTP ${lifetime.status}`);

    // ── /api/entitlement returns role (plan + type) for the app to segregate ──
    const entMissing = await req('GET', '/api/entitlement?email=nobody@example.com', { Authorization: `Bearer ${SECRET}` });
    check('entitlement: unknown email is a free individual',
      entMissing.status === 200 && entMissing.json && entMissing.json.plan === 'free' && entMissing.json.type === 'individual' && entMissing.json.pro === false,
      JSON.stringify(entMissing.json));
    const entNoAuth = await req('GET', '/api/entitlement?email=nobody@example.com', {});
    check('entitlement: requires the shared secret (401)', entNoAuth.status === 401, `HTTP ${entNoAuth.status}`);
  } catch (e) {
    failures++; console.error('ERROR', e && e.stack ? e.stack : e);
  } finally {
    server.close();
    if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
    console.log('\nALL PASS (0 failures)');
    process.exit(0);
  }
});
