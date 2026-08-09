#!/usr/bin/env node
/**
 * Homepage console-cleanliness guards (Best Practices: errors-in-console /
 * inspector-issues).
 *
 * The dark WebGL backdrop (#neuro) is retired — hidden with `display:none` in
 * every theme — but its script still compiled shaders, and a shader failure on
 * some GPUs (incl. PageSpeed's mobile software renderer) logs `console.error`,
 * which fails the "Browser errors were logged to the console" audit. The script
 * must bail while the canvas is hidden, before it touches WebGL. The deferred
 * animation loader must also swallow its own load errors.
 *
 * Usage: node test/homepage-console-clean.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// The #neuro backdrop is display:none in the theme (retired feature).
check('#neuro is hidden in CSS (retired backdrop)', /#neuro\s*\{[^}]*display:\s*none/.test(html));

// Its script bails on the hidden canvas BEFORE creating a WebGL context —
// so no shaders compile and no console.error can fire.
const neuroIdx = html.indexOf("getElementById('neuro')");
check('#neuro script exists', neuroIdx !== -1);
if (neuroIdx !== -1) {
  const guardIdx = html.indexOf("getComputedStyle", neuroIdx);
  const ctxIdx = html.indexOf("getContext('webgl'", neuroIdx);
  check('WebGL init is guarded by a display:none check', guardIdx !== -1 && ctxIdx !== -1 && guardIdx < ctxIdx,
    `guard@${guardIdx} ctx@${ctxIdx}`);
  check('guard returns when hidden', /display\s*===\s*'none'\s*\)\s*return/.test(html.slice(neuroIdx, ctxIdx + 40)));
}

// The deferred scroll-animation loader swallows load errors (no unhandled
// rejection surfaced to the console).
check('animation loader has a .catch()', /inject\('\/site-motion\.js'\)[\s\S]{0,40}\}\)\s*\.catch\(/.test(html) || /site-motion\.js'\);\s*\}\)\s*\.catch\(/.test(html));

if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
process.exit(0);
