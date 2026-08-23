#!/usr/bin/env node
/**
 * Regression: the global-language-toggle / shared-nav injectors must insert
 * their <script> before the document's REAL closing </body>, not the first one.
 * app.html builds a full HTML document string in a JS template literal that
 * contains `</body>` well before the page's own </body>. Injecting at the first
 * match dropped a <script>…</script> into the middle of that JS string; the
 * browser terminated the whole inline app script at that stray </script>
 * ("Unexpected end of input"), leaving showTab() and every dashboard handler
 * undefined — so every dashboard button went dead. This guards the fix.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-dsi-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: urlPath }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

let PORT;
const server = app.listen(0, async () => {
  PORT = server.address().port;
  try {
    const html = await get('/dashboard');

    // The browser parses the first inline <script> up to the first following
    // </script>. Extract exactly that and confirm it is valid JS.
    const openIdx = html.search(/<script>\s*\n/);
    const start = html.indexOf('\n', openIdx) + 1;
    const closeIdx = html.indexOf('</script>', start);
    const firstScript = html.slice(start, closeIdx);

    check('dashboard serves a first inline script block', openIdx !== -1 && closeIdx !== -1);
    check('the injected language toggle is NOT inside the main app script',
      !firstScript.includes('top-language-toggle.js'),
      'toggle <script> landed inside the main inline script');

    let parseOk = true, err = '';
    try { new Function(firstScript); } catch (e) { parseOk = false; err = e.message; }
    check('the main dashboard inline script parses (defines showTab etc.)', parseOk, err);
    check('showTab is defined in the main script', /function\s+showTab\s*\(/.test(firstScript));

    // The toggle must still be injected once, before the real </body>.
    check('the language toggle is injected exactly once', (html.match(/top-language-toggle\.js/g) || []).length === 1);
  } catch (e) {
    check('test ran without throwing', false, e.message);
  }
  server.close();
  if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
  console.log('\nALL PASS (0 failures)');
});
