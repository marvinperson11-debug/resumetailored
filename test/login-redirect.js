#!/usr/bin/env node
/**
 * Login page + post-login redirect.
 *
 * Two layers:
 *  1. The pure redirect sanitizer (public/login-redirect.js) — same code the
 *     browser runs — is unit-tested directly (open-redirect / loop protection).
 *  2. The real Express app is booted to prove /login now serves the dedicated
 *     login page (NOT the dashboard app), /signup too, and that email login +
 *     signup still return a session the login page can store.
 *
 * Usage: node test/login-redirect.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const L = require('../public/login-redirect.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── 1. Pure sanitizer ────────────────────────────────────────────────────────
check('keeps a normal same-origin path', L.sanitizeRedirect('/job-tracker') === '/job-tracker');
check('keeps a hyphenated path', L.sanitizeRedirect('/pro-tools') === '/pro-tools');
check('keeps root', L.sanitizeRedirect('/') === '/');
check('keeps query string', L.sanitizeRedirect('/score?lang=zh') === '/score?lang=zh');
check('rejects protocol-relative //evil', L.sanitizeRedirect('//evil.com') === null);
check('rejects absolute URL', L.sanitizeRedirect('https://evil.com') === null);
check('rejects backslash trick', L.sanitizeRedirect('/\\evil.com') === null);
check('rejects /login (loop)', L.sanitizeRedirect('/login') === null);
check('rejects /login?x=1 (loop)', L.sanitizeRedirect('/login?next=/a') === null);
check('rejects /signup (loop)', L.sanitizeRedirect('/signup') === null);
check('rejects javascript:', L.sanitizeRedirect('javascript:alert(1)') === null);
check('rejects empty/null', L.sanitizeRedirect('') === null && L.sanitizeRedirect(null) === null);
check('resolveTarget prefers a valid param', L.resolveTarget('/score', 'https://x.com/y', 'https://x.com', '/dashboard') === '/score');
check('resolveTarget falls back to same-origin referrer', L.resolveTarget(null, 'https://x.com/pro-tools', 'https://x.com', '/dashboard') === '/pro-tools');
check('resolveTarget ignores cross-origin referrer', L.resolveTarget(null, 'https://evil.com/x', 'https://x.com', '/dashboard') === '/dashboard');
check('resolveTarget default when nothing valid', L.resolveTarget('//bad', '', 'https://x.com', '/dashboard') === '/dashboard');

// ── 2. Routes ────────────────────────────────────────────────────────────────
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-login-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', c => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, json: j, body: b }); });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

let PORT;
const server = app.listen(0, async () => {
  PORT = server.address().port;
  try {
    const login = await req('GET', '/login');
    check('/login responds 200', login.status === 200, String(login.status));
    check('/login serves the dedicated login page (not the app)',
      /Log in \/ Sign up/.test(login.body) && /login-redirect\.js/.test(login.body) && !/id="jtDashRoot"/.test(login.body), login.body.slice(0, 120));
    const signupPage = await req('GET', '/signup');
    check('/signup also serves the login page', signupPage.status === 200 && /Log in \/ Sign up/.test(signupPage.body));

    // Email signup + login still return a session (what the page stores).
    const su = await req('POST', '/api/auth/signup', { email: 'red@x.com', username: 'Red', password: 'Sup3r-Secret-Pw-9!' });
    check('signup returns a session token', su.status === 200 && !!su.json.token, su.body);
    const li = await req('POST', '/api/auth/login', { email: 'red@x.com', password: 'Sup3r-Secret-Pw-9!' });
    check('login returns a session token', li.status === 200 && !!li.json.token && li.json.email === 'red@x.com', li.body);
    const bad = await req('POST', '/api/auth/login', { email: 'red@x.com', password: 'wrong' });
    check('login rejects a bad password', bad.status === 401);
  } catch (e) {
    console.error('ERROR', e && e.stack ? e.stack : e); failures++;
  } finally {
    server.close();
    if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
    else console.log('\nALL PASS');
  }
});
