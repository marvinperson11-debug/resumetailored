#!/usr/bin/env node
'use strict';

// The in-page "Back" control has been removed from the product — users rely on
// the browser's native Back button. This guards that removal: back-nav.js is now
// a teardown/no-op, no page ships a hardcoded explicit-back link, and nothing
// navigates via history.back().
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const nav = read('public/back-nav.js');
const app = read('public/app.html');
const employer = read('public/employer.html');
let failed = 0;

function check(name, ok) {
  if (ok) console.log('PASS', name);
  else { console.error('FAIL', name); failed++; }
}

// back-nav.js is now a removal + no-op shim.
check('back-nav.js removes any legacy back controls', /function removeBackControls\(/.test(nav) && /\.rt-explicit-back/.test(nav) && /\.th-back/.test(nav));
check('back-nav.js exposes a no-op RTBackNav API', /window\.RTBackNav\s*=/.test(nav) && /refreshApp:\s*removeBackControls/.test(nav) && /refreshEmployer:\s*removeBackControls/.test(nav));
check('back-nav.js no longer defines a static parent map', !/STATIC_PARENTS/.test(nav) && !/appParents:\s*APP_PARENTS/.test(nav));
check('back-nav.js injects no explicit-back link', !/makeLink\(/.test(nav) && !/rt-explicit-back['"]/.test(nav));

// No page ships a hardcoded explicit-back control any more.
check('app.html has no hardcoded explicit-back link', !/rt-explicit-back/.test(app));
check('app.html has no "Back to Pricing" / "Back to Free Tools" back link', !/aria-label="Back to (Pricing|Free Tools)"/.test(app));

// A representative sample of tool pages: their inline .th-back markup may remain
// in source, but back-nav.js strips it at runtime — assert the teardown covers it.
check('back-nav.js teardown selector covers the tool-page .th-back link', /\.th-back/.test(nav));

// Native Back only — nothing calls history.back().
check('no page navigates via history.back()', !/history\s*\.\s*back\s*\(/.test(nav + app + employer));

if (failed) {
  console.error(`\n${failed} back-navigation removal check(s) failed.`);
  process.exit(1);
}
console.log('\nAll back-navigation removal checks passed.');
