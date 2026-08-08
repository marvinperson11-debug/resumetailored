#!/usr/bin/env node
/**
 * AdSense removal + deferred Analytics — source guard.
 *
 * Policy: Google AdSense is removed from the homepage and the app dashboard
 * entirely (it was never on any blog/content page). Google Analytics stays but
 * on the homepages loads lazily on first interaction (or a 3s timeout), so it
 * never blocks the initial render. This test fails if AdSense creeps back into
 * a product/landing page or if the homepage re-adds an eager, render-time gtag
 * script in <head>.
 *
 * Usage: node test/no-adsense.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');

// ── AdSense must be gone from the product surfaces ───────────────────────────
for (const f of ['index.html', 'app.html', 'zh/index.html']) {
  const html = read(f);
  check(`${f} has no adsbygoogle`, !/adsbygoogle/.test(html));
  check(`${f} has no googlesyndication script`, !/googlesyndication\.com/.test(html));
}
// And nothing dangling from the old rewarded-ad gate in app.html.
const app = read('app.html');
check('app.html has no ad-gate leftovers', !/ADSENSE_SLOT_ID|adGateModal|completeAdGate|closeAdModal/.test(app));
check('app.html keeps the real (auth-gated) download flow', /function showDownloadGate/.test(app));

// ── Homepages defer Analytics (no eager gtag <script src> in the document) ───
for (const f of ['index.html', 'zh/index.html']) {
  const html = read(f);
  check(`${f} does not eager-load gtag.js`, !/<script[^>]*googletagmanager\.com\/gtag\/js/.test(html), f);
  check(`${f} still defines window.gtag so events queue`, /window\.gtag\s*=\s*function/.test(html));
  check(`${f} loads GA on interaction or a timeout`, /addEventListener\(\s*e\s*,\s*load/.test(html) && /setTimeout\(\s*load/.test(html));
}

if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
process.exit(0);
