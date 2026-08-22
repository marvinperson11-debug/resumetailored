#!/usr/bin/env node
'use strict';

// Repository-wide guard for controls that look interactive but have no action.
// Rendered breakpoint checks remain separate because source alone cannot prove
// stacking/occlusion, but this catches the much more common dead-CTA regressions
// across every checked-in HTML page (including generated example pages).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'public');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.html')) files.push(full);
  }
}
walk(root);

const failures = [];
let buttons = 0;
let anchors = 0;

function lineAt(source, index) { return source.slice(0, index).split('\n').length; }
function selectorHasClickBinding(source, selector) {
  let from = 0;
  while ((from = source.indexOf(selector, from)) !== -1) {
    const nearby = source.slice(Math.max(0, from - 1800), from + 3000);
    if (/addEventListener\s*\(\s*['"]click['"]|\.onclick\s*=/.test(nearby)) return true;
    from += selector.length;
  }
  return false;
}

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file).replace(/\\/g, '/');

  for (const match of source.matchAll(/<button\b[^>]*>/gi)) {
    buttons++;
    const tag = match[0];
    if (/\bonclick\s*=/i.test(tag) || /\btype\s*=\s*['"](?:submit|reset)['"]/i.test(tag)) continue;
    const id = (tag.match(/\bid\s*=\s*['"]([^'"]+)['"]/i) || [])[1];
    const classes = ((tag.match(/\bclass\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || '').split(/\s+/).filter(Boolean);
    const selectors = [];
    if (id && !/[${}]/.test(id)) selectors.push(`'${id}'`, `"${id}"`);
    for (const cls of classes) if (!/[${}]/.test(cls)) selectors.push(`.${cls}`);
    if (selectors.some((selector) => selectorHasClickBinding(source, selector))) continue;
    failures.push(`${rel}:${lineAt(source, match.index)} button has no click/submit binding: ${tag.replace(/\s+/g, ' ')}`);
  }

  for (const match of source.matchAll(/<a\b[^>]*>/gi)) {
    anchors++;
    const tag = match[0];
    if (/href\\?=['"]\s*['"]?\s*\+|href\\?=['"][^>]*\+[^>]*['"]/i.test(tag)) continue;
    const href = (tag.match(/\bhref\s*=\s*['"]([^'"]*)['"]/i) || [])[1];
    if (href && href !== '#') continue;
    if (/\bonclick\s*=/i.test(tag)) continue;
    const id = (tag.match(/\bid\s*=\s*['"]([^'"]+)['"]/i) || [])[1];
    // These start hidden/disabled and receive their real public URL only after
    // a successful publish/load. Keeping a placeholder href preserves native
    // link semantics once the URL is assigned.
    if (id === 'wcViewLive' && /viewLive\.href\s*=/.test(source)) continue;
    if (id === 'openSiteBtn' && /openBtn\.href\s*=/.test(source)) continue;
    failures.push(`${rel}:${lineAt(source, match.index)} anchor has no usable href or click binding: ${tag.replace(/\s+/g, ' ')}`);
  }

  // Ignore IDs embedded in JavaScript template strings: they are not part of
  // the live document at the same time as the markup they replace.
  const markupOnly = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const ids = [...markupOnly.matchAll(/\bid\s*=\s*['"]([^'"]+)['"]/gi)].map((match) => match[1]);
  for (const id of new Set(ids)) {
    if (ids.filter((value) => value === id).length > 1) failures.push(`${rel} contains duplicate DOM id "${id}"`);
  }
}

if (files.length < 300) failures.push(`expected the full public page catalog, found only ${files.length} HTML files`);
if (failures.length) {
  for (const failure of failures) console.error('FAIL  ' + failure);
  console.error(`\n${failures.length} button-integrity failure(s)`);
  process.exit(1);
}
console.log(`PASS  ${files.length} HTML pages; ${buttons} buttons and ${anchors} links have action semantics`);
