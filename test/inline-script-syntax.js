#!/usr/bin/env node
/**
 * Every inline <script> on the public landing pages must parse. A single
 * unescaped quote in one string literal kills the whole script, which silently
 * takes down everything defined after it (the Contact Us modal, language
 * toggle, ...). Usage: node test/inline-script-syntax.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PAGES = ['index.html'];
let failures = 0;
for (const page of PAGES) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', page), 'utf8');
  const re = /<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(html))) {
    if (!m[1].trim()) continue;
    n++;
    try { new vm.Script(m[1], { filename: page }); }
    catch (e) { failures++; console.error(`FAIL  ${page} inline script #${n}: ${e.message}`); }
  }
  if (!failures) console.log(`PASS  ${page}: ${n} inline scripts parse`);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const ok = /id="contactModal"/.test(html) && /function openContactModal\(/.test(html) && /openContactModal\(\)/.test(html);
if (ok) console.log('PASS  Contact Us modal, opener and footer link are present'); else { failures++; console.error('FAIL  contact modal wiring'); }
if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
console.log('\nALL PASS');
