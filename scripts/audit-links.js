#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-button-links-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');

const publicRoot = path.join(__dirname, '..', 'public');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.html') && !full.includes(`${path.sep}flyers${path.sep}`) && !full.includes(`${path.sep}og${path.sep}`)) files.push(full);
  }
}
walk(publicRoot);

function pageRoute(file) {
  let rel = path.relative(publicRoot, file).replace(/\\/g, '/').replace(/\.html$/, '');
  if (rel === 'index') return '/';
  if (rel.endsWith('/index')) rel = rel.slice(0, -6);
  return '/' + rel;
}

const refs = new Map();
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const base = new URL(pageRoute(file), 'http://127.0.0.1');
  for (const match of source.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const href = match[1].trim();
    if (!href || href.startsWith('#') || /^(?:mailto:|tel:|javascript:|data:)/i.test(href) || /[${}]/.test(href)) continue;
    let url;
    try { url = new URL(href, base); } catch (_) { continue; }
    if (url.origin !== 'http://127.0.0.1') continue;
    url.hash = '';
    const key = url.pathname + url.search;
    if (!refs.has(key)) refs.set(key, []);
    refs.get(key).push(path.relative(publicRoot, file));
  }
}

const server = app.listen(0, async () => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const failures = [];
  try {
    for (const [route, sources] of refs) {
      const response = await fetch(origin + route, { redirect: 'manual' });
      if (response.status >= 400) failures.push({ route, status: response.status, sources: [...new Set(sources)].slice(0, 5) });
    }
  } finally {
    server.close();
  }
  console.log(JSON.stringify({ checked: refs.size, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
});
