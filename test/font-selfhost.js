#!/usr/bin/env node
/**
 * Self-hosted fonts — live rewrite behavior.
 *
 * Boots the real app and asserts that the server-side font rewrite:
 *  - collapses the Google Fonts <link>(s) for Inter/Fraunces/Syne into a single
 *    self-hosted /fonts.css (+ preload of the two above-the-fold Latin faces),
 *  - drops the now-unused fonts.googleapis/gstatic preconnects on those pages,
 *  - leaves the signature script fonts (Dancing Script/…/Caveat) and the
 *    runtime ${sigFont} link on the CDN (the dashboard still needs them),
 *  - serves /fonts.css and the woff2 files (woff2 long-cached).
 *
 * The point is no returning browser should hit fonts.googleapis.com for body
 * text — that render-blocking third-party chain was the biggest mobile FCP cost
 * on a page whose LCP is text, not an image.
 *
 * Usage: node test/font-selfhost.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-fonts-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

function req(urlPath) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: 'GET' }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', c => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    r.end();
  });
}

let PORT;
const server = app.listen(0, async () => {
  PORT = server.address().port;
  try {
    // The self-hosted font files exist on disk (build-fonts.js output).
    const fontsDir = path.join(__dirname, '..', 'public', 'fonts');
    check('public/fonts.css exists', fs.existsSync(path.join(__dirname, '..', 'public', 'fonts.css')));
    check('inter Latin woff2 exists', fs.existsSync(path.join(fontsDir, 'inter-normal-latin.woff2')));
    check('fraunces Latin woff2 exists', fs.existsSync(path.join(fontsDir, 'fraunces-normal-latin.woff2')));

    for (const p of ['/', '/score', '/pro-tools', '/tools/offer-comparison']) {
      const r = await req(p);
      check(`${p} 200`, r.status === 200);
      check(`${p} links self-hosted /fonts.css`, /href="\/fonts\.css\?v=[^"]+"/.test(r.body), p);
      check(`${p} preloads the Inter Latin face`, /rel="preload"[^>]*\/fonts\/inter-normal-latin\.woff2[^>]*crossorigin/.test(r.body));
      // The preload href MUST match the @font-face src byte-for-byte, or the
      // browser downloads it, never matches it, and warns "preloaded but not
      // used". fonts.css has NO version query, so the preload must not either.
      check(`${p} font preload href carries no ?v= (matches fonts.css src)`, !/\/fonts\/(inter|fraunces)-normal-latin\.woff2\?/.test(r.body), p);
      check(`${p} no longer requests body fonts from Google`, !/fonts\.googleapis\.com\/css2/.test(r.body), p);
      check(`${p} drops the gstatic preconnect`, !/fonts\.gstatic\.com/.test(r.body));
    }

    // Dashboard keeps the signature fonts (they are not self-hosted).
    const d = await req('/dashboard');
    check('/dashboard keeps signature fonts on the CDN', /fonts\.googleapis\.com\/css2\?family=Dancing\+Script/.test(d.body));
    check('/dashboard still self-hosts its Inter/Syne', /href="\/fonts\.css\?v=/.test(d.body));
    check('/dashboard leaves the runtime ${sigFont} link intact', d.body.includes('${encodeURIComponent(sigFont)}'));

    // Assets serve.
    const fc = await req('/fonts.css');
    check('/fonts.css serves as CSS', fc.status === 200 && /text\/css/.test(fc.headers['content-type']));
    check('/fonts.css is no-cache + version-busted at reference (revalidates)', fc.headers['cache-control'] === 'no-cache');
    const wf = await req('/fonts/inter-normal-latin.woff2');
    check('woff2 serves', wf.status === 200);
    check('woff2 is long-cached (heaviest asset, content-stable)', /max-age=\d{5,}/.test(wf.headers['cache-control'] || ''), wf.headers['cache-control']);
  } catch (err) {
    failures++;
    console.error('FATAL', err);
  } finally {
    server.close();
    if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
    console.log('\nALL PASS (0 failures)');
    process.exit(0);
  }
});
