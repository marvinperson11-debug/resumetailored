#!/usr/bin/env node
/** HEAD on clean-URL HTML pages mirrors GET (status + headers, empty body). */
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-head-'));
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
let failures = 0;
const check = (n, c, d) => { if (c) console.log('PASS  ' + n); else { failures++; console.error('FAIL  ' + n + (d ? ' — ' + d : '')); } };
const req = (port, method, p) => new Promise((res, rej) => {
  const r = http.request({ port, path: p, method }, (resp) => { let b = ''; resp.on('data', (c) => b += c); resp.on('end', () => res({ status: resp.statusCode, headers: resp.headers, body: b })); });
  r.on('error', rej); r.end();
});
const server = app.listen(0, async () => {
  const port = server.address().port;
  for (const p of ['/blog/resume-website-builder', '/faq']) {
    const g = await req(port, 'GET', p), h = await req(port, 'HEAD', p);
    check(`${p}: GET is 200`, g.status === 200, g.status);
    check(`${p}: HEAD status matches GET`, h.status === g.status, h.status);
    check(`${p}: HEAD content-type matches`, h.headers['content-type'] === g.headers['content-type']);
    check(`${p}: HEAD body empty`, h.body === '');
  }
  check('unknown path HEAD still 404', (await req(port, 'HEAD', '/definitely-not-a-page-xyz')).status === 404);
  console.log(failures ? failures + ' FAILURE(S)' : 'ALL PASS');
  server.close(); process.exit(failures ? 1 : 0);
});
