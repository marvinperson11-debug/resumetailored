#!/usr/bin/env node
/**
 * Guards for three homepage/nav fixes:
 *   1. Job Tracker is NOT a top-level nav tab — it lives inside Free Tools
 *      (/score). site-nav.js must not list it; the /score hub must link it.
 *   2. The custom desktop cursor (the little green dot + ring) is gone —
 *      site-motion.js no longer builds it and site-fx.css no longer styles it.
 *   3. The nav is auth-aware and the login page no longer silently bounces a
 *      signed-in visitor: site-nav.js + index.html swap "Log In" → "Dashboard"
 *      after validating the token, and login.html shows an "already signed in"
 *      panel instead of an instant redirect.
 *
 * Source-level (no browser) so it runs inside the plain-node test loop.
 *
 * Usage: node test/nav-cursor-login.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// ── 1. Job Tracker is not a nav tab ─────────────────────────────────────────
const siteNav = read('public/site-nav.js');
check('site-nav.js has no Job Tracker tab', !/'Job Tracker'/.test(siteNav));
check('site-nav.js has no /job-tracker link in its LINKS', !/\/job-tracker/.test(siteNav));
// It must still live inside the Free Tools hub.
const score = read('public/score.html');
check('/score (Free Tools hub) still links Job Tracker', /href="\/job-tracker"/.test(score));
// The homepage's own nav must not carry a Job Tracker tab either.
const index = read('public/index.html');
check('homepage nav has no Job Tracker link', !/href="\/job-tracker"/.test(index));

// ── 2. Custom cursor removed ────────────────────────────────────────────────
const motion = read('public/site-motion.js');
check('site-motion.js no longer calls customCursor()', !/customCursor\s*\(/.test(motion));
check('site-motion.js no longer builds #rt-cursor', !/id\s*=\s*['"]rt-cursor/.test(motion) && !/rt-has-cursor/.test(motion));
const fx = read('public/site-fx.css');
check('site-fx.css no longer styles #rt-cursor', !/#rt-cursor/.test(fx));
check('site-fx.css no longer hides the native cursor', !/cursor:\s*none/.test(fx));

// ── 3. Auth-aware nav + no silent login bounce ──────────────────────────────
check('site-nav.js validates the session via /api/auth/me', /\/api\/auth\/me/.test(siteNav));
check('site-nav.js swaps Log In → Dashboard when signed in', /data-snav-authed/.test(siteNav) && /Dashboard/.test(siteNav));
check('homepage nav is auth-aware (Log In → Dashboard)', /\/api\/auth\/me/.test(index) && /nav_login/.test(index) && /Dashboard/.test(index));

const login = read('public/login.html');
// The old code: `.then(function (r) { if (r.ok) goTarget(); })` — an instant
// redirect. It must be gone in favor of the visible panel.
check('login.html does not instantly redirect a signed-in user',
  !/if\s*\(\s*r\.ok\s*\)\s*goTarget\(\)/.test(login));
check('login.html shows an "already signed in" panel instead', /id="already"/.test(login) && /showAlready/.test(login));
check('login.html offers a way out (Use a different account / log out)', /logoutBtn/.test(login) && /removeItem\('rt_token'\)/.test(login));

if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
process.exit(0);
