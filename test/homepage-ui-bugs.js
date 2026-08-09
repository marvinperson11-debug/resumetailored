#!/usr/bin/env node
/**
 * Guards for three homepage/nav UI fixes:
 *
 *   1. Hero above the fold — the homepage headline + primary CTA must clear the
 *      fold on a 1366×768 laptop. Source-level proxy: the hero's top padding is
 *      kept tight and the headline clamp is capped, so the stack that used to
 *      push the CTA below 768px no longer does. (The live geometry is checked by
 *      hand with a browser; this locks the CSS values that produce it.)
 *
 *   2. One nav, one 中文 position — the language toggle must sit in the SAME
 *      right-aligned action group as Log In / the CTA on every route, matching
 *      the injected nav (site-nav.js). On the homepage that means 中文 lives
 *      INSIDE .nav-actions, before the login link — not floated after the CTA.
 *
 *   3. No white flash between pages — a same-origin MPA view transition is
 *      declared on both the homepage (inline) and the injected nav (site-nav.js,
 *      present on every other route), so both ends of a navigation opt in.
 *
 * Source-level (no browser) so it runs inside the plain-node test loop.
 *
 * Usage: node test/homepage-ui-bugs.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const index = read('public/index.html');
const siteNav = read('public/site-nav.js');

// ── 1. Hero above the fold ──────────────────────────────────────────────────
// The hero top padding used to be 100px; combined with a 76px headline it
// pushed the CTA past 768px. Keep the top padding small and the headline cap
// modest.
const heroPad = index.match(/\.hero\s*\{\s*padding:\s*(\d+)px\s+0\s+(\d+)px/);
check('hero rule found', !!heroPad);
check('hero top padding is tight (≤ 60px)', heroPad && Number(heroPad[1]) <= 60,
  heroPad ? `top padding is ${heroPad[1]}px` : undefined);
const heroClamp = index.match(/\.hero h1[\s\S]*?font-size:\s*clamp\(\s*\d+px\s*,\s*[\d.]+vw\s*,\s*(\d+)px\s*\)/);
check('hero headline clamp max is capped (≤ 64px)', heroClamp && Number(heroClamp[1]) <= 64,
  heroClamp ? `clamp max is ${heroClamp[1]}px` : 'clamp not found');

// ── 2. 中文 lives inside the right-aligned action group (same spot everywhere) ─
// The desktop language toggle must be the first child of .nav-actions, before
// the Log In link — so its position matches site-nav.js's [中文][Login][CTA].
const navActions = index.match(/<div class="nav-actions">([\s\S]*?)<\/div>/);
check('.nav-actions block found', !!navActions);
if (navActions) {
  const block = navActions[1];
  const langIdx = block.indexOf('id="langToggleBtn"');
  const loginIdx = block.indexOf('data-i18n="nav_login"');
  const ctaIdx = block.indexOf('data-i18n="nav_cta"');
  check('中文 toggle is inside .nav-actions', langIdx !== -1);
  check('中文 comes before Log In inside .nav-actions', langIdx !== -1 && loginIdx !== -1 && langIdx < loginIdx);
  check('Log In comes before the CTA (order [中文][Login][CTA])', loginIdx !== -1 && ctaIdx !== -1 && loginIdx < ctaIdx);
}
// The old layout floated the toggle AFTER the actions group (a sibling of, not
// inside, .nav-actions). Make sure that pattern is gone.
check('中文 toggle is not floated after .nav-actions',
  !/<\/div>\s*<button class="btn btn-ghost lang-toggle"[^>]*id="langToggleBtn"/.test(index));
// site-nav.js keeps its own [中文][Login][CTA] order in the snav-act group.
check('site-nav.js orders 中文 before login in .snav-act',
  siteNav.indexOf('class="snav-lang"') < siteNav.indexOf('data-snav-login'));

// ── 3. MPA view transition on both ends of every navigation ─────────────────
check('homepage declares @view-transition navigation:auto',
  /@view-transition\s*\{\s*navigation:\s*auto/.test(index));
check('homepage disables the transition under reduced-motion',
  /prefers-reduced-motion:\s*reduce[\s\S]*@view-transition\s*\{\s*navigation:\s*none/.test(index));
check('site-nav.js injects @view-transition navigation:auto',
  /@view-transition\{navigation:auto/.test(siteNav));
check('site-nav.js disables the transition under reduced-motion',
  /prefers-reduced-motion:reduce\)\{@view-transition\{navigation:none/.test(siteNav));

if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
process.exit(0);
