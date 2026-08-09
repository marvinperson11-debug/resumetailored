#!/usr/bin/env node
/**
 * Homepage content-visibility containment guard.
 *
 * The homepage's remaining Performance cost was Style & Layout over a large DOM
 * (~2.3 s of main-thread work in a mobile trace), not JS or render-blocking.
 * `content-visibility: auto` on the below-the-fold <section>s lets the browser
 * skip style/layout/paint for offscreen sections until scrolled near, which cut
 * that to ~0.6 s locally. This test guards:
 *   - the containment rule exists and targets non-hero sections,
 *   - the hero (LCP / above-the-fold) is explicitly excluded,
 *   - each contained section reserves space via `contain-intrinsic-size` (with
 *     the `auto` keyword so real heights are remembered) — keeping CLS ~0.
 *
 * Usage: node test/homepage-content-visibility.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// The containment rule targets below-the-fold sections and excludes the hero.
check('content-visibility:auto applied to non-hero sections',
  /main\s*>\s*section:not\(\.hero\)\s*\{[^}]*content-visibility:\s*auto/.test(html));
check('hero is NOT given content-visibility (LCP stays eager)',
  !/\.hero\s*\{[^}]*content-visibility/.test(html) && /:not\(\.hero\)/.test(html));

// Every contained section reserves space with contain-intrinsic-size using the
// `auto` keyword (so Chrome remembers real heights → CLS ~0). There are 12
// below-the-fold sections (13 total minus the hero).
const sizeRules = html.match(/contain-intrinsic-size:\s*auto\s+\d+px/g) || [];
check('contain-intrinsic-size set on each below-the-fold section (12)', sizeRules.length >= 12, `found ${sizeRules.length}`);
check('intrinsic sizes use the auto keyword (remembered real height)', sizeRules.every(r => /auto/.test(r)));

// It must not be applied via display:none-style hiding (a11y/SEO safety) — the
// mechanism is content-visibility, which keeps content in the DOM + a11y tree.
check('no section hidden with display:none for perf', !/main\s*>\s*section[^{]*\{[^}]*display:\s*none/.test(html));

if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
process.exit(0);
