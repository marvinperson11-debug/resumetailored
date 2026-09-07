#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
let failures = 0;
function check(name, ok) { if (ok) console.log('PASS', name); else { failures++; console.error('FAIL', name); } }

const server = read('server.js');
const index = read('public/index.html');
const corporate = read('public/corporate.html');
const success = read('public/success.html');
const ecosystem = read('public/luxury-ecosystem.js');

// No landing page initiates Stripe checkout any more. Every Pro/lifetime/
// employer CTA links straight to the dashboard app; the on-site
// paid-checkout.js client and all data-checkout-plan hooks have been removed.
check('homepage Pro CTAs route to the app upgrade flow', /app\.resumetailored\.com\?upgrade=pro/.test(index) && !/data-checkout-plan/.test(index));
check('paid-checkout.js has been removed from the repo', !fs.existsSync(path.join(root, 'public/paid-checkout.js')));
// Walk every public HTML file: none may load paid-checkout.js or carry a
// data-checkout-plan hook — the site-wide "no on-site Stripe checkout" invariant.
(function () {
  const offenders = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.html')) {
        const html = fs.readFileSync(full, 'utf8');
        if (/paid-checkout\.js/.test(html) || /data-checkout-plan/.test(html)) offenders.push(path.relative(root, full));
      }
    }
  })(path.join(root, 'public'));
  check('no public HTML loads paid-checkout.js or uses data-checkout-plan', offenders.length === 0, offenders.join(', '));
})();
check('guest-friendly checkout starts cannot be blocked by stale session CSRF', /p === '\/api\/subscribe'[\s\S]{0,180}p === '\/api\/subscribe-lifetime'[\s\S]{0,180}p === '\/api\/employer\/subscribe'[\s\S]{0,80}return next\(\)/.test(server));
check('Corporate pricing uses the standard logo and hamburger-only header', /class="club-nav cp-header"[\s\S]{0,350}class="club-mobile cp-menu-trigger"/.test(corporate) && !/class="club-nav cp-header"[\s\S]{0,500}Open the Portal/.test(corporate));
check('monthly checkout accepts guest email collection', /app\.post\('\/api\/subscribe'[\s\S]{0,900}email is OPTIONAL/.test(server));
check('lifetime checkout no longer requires a pre-entered email', !/subscribe-lifetime'[\s\S]{0,250}Email required/.test(server));
check('employer checkout no longer requires employer auth', /employer\/subscribe'[\s\S]{0,500}guest-friendly/.test(server));
check('placeholder price variables cannot override the canonical Stripe catalog', /function _configuredPriceId[\s\S]{0,220}_looksLikePriceId/.test(server) && /_configuredPriceId\(process\.env\.STRIPE_PRICE_ID, STRIPE_PRICE_IDS\.pro\)/.test(server));
check('Pro checkout recovers from a stale Railway price id with exact inline pricing', /StripeInvalidRequestError[\s\S]{0,900}unit_amount: 1900[\s\S]{0,200}recurring: \{ interval: 'month' \}/.test(server));
check('marketing plan buttons have one owner and never race checkout with a login redirect', !/data-checkout-plan|\/employer\?plan=/.test(ecosystem));
check('paid fulfillment auto-creates a user', /function _provisionPaidAccount[\s\S]{0,1800}INSERT INTO users/.test(server));
check('paid fulfillment sends a welcome email', /subject: `Welcome to \$\{planLabel\}/.test(server));
check('completion verifies Stripe before creating a session', /api\/checkout\/complete[\s\S]{0,1500}checkout\.sessions\.retrieve[\s\S]{0,1500}_setAuthCookies/.test(server));
check('employer fulfillment creates a starter company profile', /INSERT OR IGNORE INTO employer_profiles/.test(server));
check('success page completes and redirects to returned dashboard', /api\/checkout\/complete/.test(success) && /location\.assign\(link\.href\)/.test(success));

if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
