#!/usr/bin/env node
/**
 * Homepage scroll-animation stack is interaction-gated.
 *
 * The GSAP + ScrollTrigger + Lenis + site-motion stack — the last main-thread
 * cost on the homepage — must NOT load as eager <script> tags; it loads on the
 * first user interaction (or a 4s fallback), in dependency order. The page is
 * fully usable without it (progressive enhancement), so this only affects when
 * the decorative scroll motion begins. mobile-native.js stays deferred (its
 * touch handlers must be ready for the first touch).
 *
 * Usage: node test/homepage-motion-defer.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// None of the animation stack loads as an eager <script src=...> tag.
for (const src of ['/vendor/gsap.min.js', '/vendor/ScrollTrigger.min.js', '/vendor/lenis.min.js', '/site-motion.js']) {
  check(`no eager <script src="${src}">`, !new RegExp('<script src="' + src.replace(/[.]/g, '\\$&') + '"').test(html), src);
}
// The interaction-gated loader is present and binds to interaction + a timeout.
check('interaction loader injects gsap', /inject\('\/vendor\/gsap\.min\.js'\)/.test(html));
check('loader binds interaction events', /addEventListener\(\s*e\s*,\s*load/.test(html));
check('loader has a timeout fallback', /setTimeout\(\s*load\s*,\s*\d+\s*\)/.test(html));
// Dependency order preserved (gsap → ScrollTrigger → lenis → site-motion).
check('loads in dependency order', /gsap\.min\.js'[\s\S]*ScrollTrigger\.min\.js'[\s\S]*lenis\.min\.js'[\s\S]*site-motion\.js'/.test(html));
// Touch layer stays deferred so first-touch handlers are ready.
check('mobile-native.js stays deferred', /<script src="\/mobile-native\.js" defer><\/script>/.test(html));

if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
process.exit(0);
