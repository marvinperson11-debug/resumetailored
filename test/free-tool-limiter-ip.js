#!/usr/bin/env node
/**
 * The per-minute limiters on the free tools key on the CLIENT address
 * (CF-Connecting-IP), not on req.ip. Behind Cloudflare req.ip is the shared
 * edge address, so keying on it would make one visitor's burst throttle
 * everyone. Runs with the real limiters ON (RT_DISABLE_RATE_LIMIT unset) and
 * only sends requests that fail validation, so no model call is ever made.
 *
 * Usage: node test/free-tool-limiter-ip.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-limiter-'));
delete process.env.RT_DISABLE_RATE_LIMIT;
process.env.TOOLS_HASH_SALT = 'test-only-tools-hash-salt-0123456789';
const { app } = require('../server.js');

let seq = 0;
const server = app.listen(0, async () => {
  const PORT = server.address().port;
  const hit = (urlPath, body, cfIp) => new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
    if (cfIp) headers['CF-Connecting-IP'] = cfIp;
    // req.ip differs on every request (unique X-Forwarded-For) while CF-Connecting-IP is
    // constant per visitor: a limiter keyed on req.ip would never trip here, one keyed on
    // the visitor's address will. It also keeps the site-wide /api limiter (30/min per
    // req.ip) out of the way.
    headers['X-Forwarded-For'] = `10.9.${Math.floor(seq / 250)}.${(seq % 250) + 1}`; seq++;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: 'POST', headers }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    r.on('error', reject); r.write(payload); r.end();
  });
  try {
    const statuses = [];
    for (let i = 0; i < 9; i++) statuses.push(await hit('/api/tools/extract-keywords', { jobDescription: 'short' }, '203.0.113.50'));
    check('extractor limiter: first 8 requests from one visitor pass the limiter (400 validation)', statuses.slice(0, 8).every((s) => s === 400), statuses.join(','));
    check('extractor limiter: 9th request from that visitor => 429', statuses[8] === 429, statuses.join(','));
    check('extractor limiter: a different visitor behind the same edge is NOT throttled', (await hit('/api/tools/extract-keywords', { jobDescription: 'short' }, '203.0.113.51')) === 400);

    const dec = [];
    for (let i = 0; i < 21; i++) dec.push(await hit('/api/tools/job-description-decode', { jobText: 'short' }, '203.0.113.60'));
    check('tools limiter: 20/min per visitor, 21st => 429', dec.slice(0, 20).every((s) => s === 400) && dec[20] === 429, dec.join(','));
    check('tools limiter: a different visitor is unaffected', (await hit('/api/tools/job-description-decode', { jobText: 'short' }, '203.0.113.61')) === 400);
  } catch (e) { failures++; console.error('FAIL  crashed —', e); }
  server.close();
  if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
  console.log('\nALL PASS'); process.exit(0);
});
