#!/usr/bin/env node
/**
 * Homepage accessibility guards.
 *
 * Locks in the fixes that took the homepage from Lighthouse Accessibility 93 to
 * 100: a single <main> landmark, and WCAG-AA contrast on the footer payment row
 * (the three elements Lighthouse flagged). Source-level so it runs with no
 * browser; the color check reproduces the WCAG contrast formula.
 *
 * Usage: node test/homepage-a11y.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');

function lum(hex) {
  const c = hex.replace('#', '');
  const v = [0, 2, 4].map(i => {
    let x = parseInt(c.substr(i, 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

const FOOTER_BG = '#f1eadd'; // footer-inner background the payment row sits on

for (const f of ['index.html', 'zh/index.html']) {
  const html = read(f);

  // Exactly one <main> landmark.
  const opens = (html.match(/<main[\s>]/g) || []).length;
  const closes = (html.match(/<\/main>/g) || []).length;
  check(`${f} has exactly one <main> landmark`, opens === 1 && closes === 1, `open=${opens} close=${closes}`);

  // No reintroduction of the flagged low-contrast payment badge colors.
  check(`${f} dropped the low-contrast Alipay blue (#1677ff)`, !/#1677ff/i.test(html));
  check(`${f} dropped the low-contrast WeChat green (#09bb07)`, !/#09bb07/i.test(html));

  // The footer "Accepted Payments" label meets AA on the cream footer.
  const m = html.match(/color:(#[0-9a-fA-F]{6})[^"]*"\s+data-i18n="footer_payments"/);
  check(`${f} footer_payments label color present`, !!m, m ? m[1] : 'not found');
  if (m) check(`${f} footer_payments label ≥ 4.5:1 on footer bg`, ratio(m[1], FOOTER_BG) >= 4.5, `${m[1]} => ${ratio(m[1], FOOTER_BG).toFixed(2)}`);

  // The payment badges (white text) meet AA against their new backgrounds.
  for (const bg of (html.match(/background:(#[0-9a-fA-F]{6});border-radius:5px;padding:3px 10px;font-size:11px;font-weight:800;color:#fff/g) || [])) {
    const hex = bg.match(/#[0-9a-fA-F]{6}/)[0];
    check(`${f} payment badge #fff on ${hex} ≥ 4.5:1`, ratio('#ffffff', hex) >= 4.5, ratio('#ffffff', hex).toFixed(2));
  }
}

// index.html desktop color-contrast fixes (these elements render on desktop and
// were the exact Lighthouse-desktop failures at score 96):
{
  const html = read('index.html');
  // The shared caption/meta colour (--ink-faint) drives .hero-note/.demo-label/
  // .footer-copy. It must clear AA on the lightest backgrounds it sits on.
  const vm = html.match(/--ink-faint:\s*(#[0-9a-fA-F]{6})/);
  check('index.html --ink-faint defined', !!vm, vm ? vm[1] : 'not found');
  if (vm) {
    for (const bg of ['#ffffff', '#faf7f0', '#e8f0e9', '#f1eadd']) {
      check(`--ink-faint ≥ 4.5:1 on ${bg}`, ratio(vm[1], bg) >= 4.5, `${vm[1]} => ${ratio(vm[1], bg).toFixed(2)}`);
    }
  }
  // The bright green text (#22c55e, 2.27:1 on white) must be gone.
  check('index.html has no low-contrast color:#22c55e text', !/color:#22c55e/i.test(html));
}

if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
process.exit(0);
