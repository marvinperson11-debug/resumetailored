#!/usr/bin/env node
/*
 * test-i18n-parity.js — Scope 2b key-parity check for the Oct 2026 marketing audit.
 *
 * Verifies that every data-i18n key used in public/index.html has a matching
 * entry in BOTH the en and zh I18N tables, so Chinese mode never silently
 * leaves a keyed element untranslated (and English never breaks).
 *
 * Run: node test-i18n-parity.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'public', 'index.html');
const s = fs.readFileSync(file, 'utf8');

// All data-i18n keys referenced in the HTML
const htmlKeys = new Set();
for (const m of s.matchAll(/data-i18n="([^"]+)"/g)) htmlKeys.add(m[1]);

// Split into en table (before "zh: {") and zh table (after, before TRANS)
const zhStart = s.indexOf('zh: {');
if (zhStart < 0) { console.error('FAIL: zh table not found'); process.exit(1); }
const transStart = s.indexOf('const TRANS', zhStart);
const enSection = s.slice(0, zhStart);
const zhSection = s.slice(zhStart, transStart < 0 ? undefined : transStart);

// Keys defined in each table (handles multiple keys per line, single or double quotes)
function tableKeys(section) {
  const keys = new Set();
  for (const m of section.matchAll(/([A-Za-z0-9_]+):\s*["']/g)) keys.add(m[1]);
  return keys;
}
const enKeys = tableKeys(enSection);
const zhKeys = tableKeys(zhSection);

let failures = 0;
for (const k of [...htmlKeys].sort()) {
  const hasEn = enKeys.has(k);
  const hasZh = zhKeys.has(k);
  if (!hasEn || !hasZh) {
    failures++;
    console.log(`FAIL | ${k} | en=${hasEn ? 'ok' : 'MISSING'} zh=${hasZh ? 'ok' : 'MISSING'}`);
  }
}

console.log(`\nChecked ${htmlKeys.size} data-i18n keys.`);
if (failures) {
  console.error(`${failures} key(s) missing a table entry.`);
  process.exit(1);
}
console.log('All keys have en + zh entries. Parity check passed.');
