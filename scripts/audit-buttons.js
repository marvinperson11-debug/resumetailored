#!/usr/bin/env node
'use strict';

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

let count = 0;
let badAnchors = 0;
let duplicateIds = 0;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<button\b[^>]*>/gi)) {
    const tag = match[0];
    if (/\bonclick\s*=/i.test(tag) || /\btype\s*=\s*["'](?:submit|reset)["']/i.test(tag)) continue;
    const line = source.slice(0, match.index).split('\n').length;
    console.log(`${path.relative(root, file)}:${line}: ${tag.replace(/\s+/g, ' ')}`);
    count++;
  }
  for (const match of source.matchAll(/<a\b[^>]*>/gi)) {
    const tag = match[0];
    const href = tag.match(/\bhref\s*=\s*["']([^"']*)["']/i);
    if (href && href[1] !== '#') continue;
    if (/\bonclick\s*=/i.test(tag)) continue;
    const line = source.slice(0, match.index).split('\n').length;
    console.log(`${path.relative(root, file)}:${line}: DEAD_ANCHOR ${tag.replace(/\s+/g, ' ')}`);
    badAnchors++;
  }
  const ids = [...source.matchAll(/\bid\s*=\s*["']([^"'${}]+)["']/gi)].map((m) => m[1]);
  for (const id of new Set(ids)) {
    if (ids.filter((value) => value === id).length < 2) continue;
    console.log(`${path.relative(root, file)}: DUPLICATE_ID ${id}`);
    duplicateIds++;
  }
}
console.error(`UNHANDLED_BUTTON_CANDIDATES=${count}`);
console.error(`DEAD_ANCHORS=${badAnchors}`);
console.error(`DUPLICATE_IDS=${duplicateIds}`);
