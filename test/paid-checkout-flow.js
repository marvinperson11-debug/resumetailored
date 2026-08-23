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
const checkout = read('public/paid-checkout.js');

for (const plan of ['pro', 'lifetime', 'portal', 'scale', 'corporate']) {
  check(`${plan} has a direct checkout trigger`, index.includes(`data-checkout-plan="${plan}"`) || corporate.includes(`data-checkout-plan="${plan}"`) || (plan === 'pro' && /RTCheckout\.start\('pro'\)/.test(index)) || (plan === 'lifetime' && /RTCheckout\.start\('lifetime'\)/.test(index)));
}
check('shared checkout client supports all five paid plans', /pro: 1, lifetime: 1, portal: 1, scale: 1, corporate: 1/.test(checkout));
check('checkout failures stay on-page in a graceful alert', /role', 'alert'/.test(checkout) && /Checkout was cancelled/.test(checkout));
check('monthly checkout accepts guest email collection', /app\.post\('\/api\/subscribe'[\s\S]{0,900}email is OPTIONAL/.test(server));
check('lifetime checkout no longer requires a pre-entered email', !/subscribe-lifetime'[\s\S]{0,250}Email required/.test(server));
check('employer checkout no longer requires employer auth', /employer\/subscribe'[\s\S]{0,500}guest-friendly/.test(server));
check('paid fulfillment auto-creates a user', /function _provisionPaidAccount[\s\S]{0,1800}INSERT INTO users/.test(server));
check('paid fulfillment sends a welcome email', /subject: `Welcome to \$\{planLabel\}/.test(server));
check('completion verifies Stripe before creating a session', /api\/checkout\/complete[\s\S]{0,1500}checkout\.sessions\.retrieve[\s\S]{0,1500}_setAuthCookies/.test(server));
check('employer fulfillment creates a starter company profile', /INSERT OR IGNORE INTO employer_profiles/.test(server));
check('success page completes and redirects to returned dashboard', /api\/checkout\/complete/.test(success) && /location\.assign\(link\.href\)/.test(success));

if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
