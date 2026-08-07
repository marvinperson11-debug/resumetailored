#!/usr/bin/env node
/**
 * Security hardening — HTTP route integration.
 *
 * Boots the real Express app against a throwaway SQLite DB and drives the
 * new security surface end to end: headers, CORS, password policy, the
 * login/signup lockout, the admin-secret guard, and account export/deletion.
 * Deliberately does NOT set RT_DISABLE_RATE_LIMIT — the whole point is to
 * exercise the real rate limiters and lockout tracker.
 *
 * Usage: node test/security-routes.js
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

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-sec-'));
process.env.ADMIN_SECRET = 'test-admin-secret-value';
const { app } = require('../server.js');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)')
  .run('exists@x.com', 'Existing User', bcrypt.hashSync('Correct-Horse-1!', 4));
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokExists', 'exists@x.com');
db.prepare('INSERT INTO saved_resumes (email,title,content,created_at) VALUES (?,?,?,?)')
  .run('exists@x.com', 'My Resume', 'Some resume text', Date.now());
db.prepare('INSERT INTO check_ins (email,goals) VALUES (?,?)').run('exists@x.com', 'Get hired');

function req(method, urlPath, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const payload = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({}, opts.headers);
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    if (opts.origin) headers.Origin = opts.origin;
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', c => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, headers: res.headers, json: j, body: b }); });
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
    // ── Security headers ────────────────────────────────────────────────────
    const home = await req('GET', '/');
    check('HSTS header present', /max-age=31536000/.test(home.headers['strict-transport-security'] || ''));
    check('X-Frame-Options is SAMEORIGIN (not DENY — the site editor iframes itself)', home.headers['x-frame-options'] === 'SAMEORIGIN');
    check('X-Content-Type-Options nosniff', home.headers['x-content-type-options'] === 'nosniff');
    check('Referrer-Policy present', home.headers['referrer-policy'] === 'strict-origin-when-cross-origin');
    check('CSP present and locked to self by default', (home.headers['content-security-policy'] || '').includes("default-src 'self'"));
    check('CSP references Anthropic, not OpenAI', (home.headers['content-security-policy'] || '').includes('api.anthropic.com') && !(home.headers['content-security-policy'] || '').includes('api.openai.com'));

    // ── CORS ─────────────────────────────────────────────────────────────────
    const corsOk = await req('GET', '/api/auth/me', { origin: 'https://resumetailored.com' });
    check('allowed origin gets CORS header back', corsOk.headers['access-control-allow-origin'] === 'https://resumetailored.com');
    const corsBad = await req('GET', '/api/auth/me', { origin: 'https://evil.example.com' });
    check('disallowed origin gets NO CORS allow-origin header', !corsBad.headers['access-control-allow-origin']);

    // ── Password policy on signup ───────────────────────────────────────────
    const weakSignup = await req('POST', '/api/auth/signup', { body: { email: 'weak@x.com', username: 'Weak', password: 'weak' } });
    check('signup rejects a weak password', weakSignup.status === 400 && /8 characters|uppercase|lowercase|number|symbol/i.test(weakSignup.json.error || ''), weakSignup.body);
    check('weak password did not create an account', !db.prepare('SELECT 1 FROM users WHERE email=?').get('weak@x.com'));

    const strongSignup = await req('POST', '/api/auth/signup', { body: { email: 'strong@x.com', username: 'Strong', password: 'Xq7$vTmz!wR29Lp' } });
    check('signup accepts a compliant password', strongSignup.status === 200 && !!strongSignup.json.token, strongSignup.body);

    // ── Login lockout (5 failures -> 429, Retry-After) ──────────────────────
    let lastFail;
    for (let i = 0; i < 5; i++) {
      lastFail = await req('POST', '/api/auth/login', { body: { email: 'exists@x.com', password: 'wrong-password' } });
    }
    check('5th failed login is still a normal 401 (not yet locked)', lastFail.status === 401, lastFail.body);
    const lockedAttempt = await req('POST', '/api/auth/login', { body: { email: 'exists@x.com', password: 'wrong-password' } });
    check('6th failed attempt is locked out (429)', lockedAttempt.status === 429, lockedAttempt.body);
    check('locked response carries Retry-After', !!lockedAttempt.headers['retry-after']);
    const evenCorrectPwLocked = await req('POST', '/api/auth/login', { body: { email: 'exists@x.com', password: 'Correct-Horse-1!' } });
    check('lockout blocks even the CORRECT password until it expires', evenCorrectPwLocked.status === 429);

    // A different IP is unaffected by exists@x.com's lockout (lockout is per-IP,
    // and every request in this test comes from the same loopback IP, so this
    // instead proves a DIFFERENT account from the same IP is also blocked —
    // confirming the key really is the IP, not the email.
    const differentAccountSameIp = await req('POST', '/api/auth/login', { body: { email: 'strong@x.com', password: 'Xq7$vTmz!wR29Lp' } });
    check('lockout is per-IP: a different account from the same IP is also blocked', differentAccountSameIp.status === 429);

    // ── Admin secret guard ───────────────────────────────────────────────────
    const badAdmin = await req('GET', '/api/admin/users-list?secret=totally-wrong');
    check('wrong admin secret is rejected', badAdmin.status === 403);
    const goodAdmin = await req('GET', `/api/admin/users-list?secret=${process.env.ADMIN_SECRET}`);
    check('correct admin secret is accepted', goodAdmin.status === 200 && Array.isArray(goodAdmin.json.users), goodAdmin.body);
    check('admin action was audit-logged', !!db.prepare("SELECT 1 FROM audit_log WHERE action='admin.users_list_export'").get());

    // ── Webhook signature verification (still correct) ──────────────────────
    const badWebhook = await req('POST', '/webhook', { body: { type: 'checkout.session.completed' }, headers: { 'stripe-signature': 'bogus' } });
    check('webhook without a valid Stripe signature is rejected (400)', badWebhook.status === 400, badWebhook.body);

    // ── Data export ───────────────────────────────────────────────────────────
    const noAuthExport = await req('GET', '/api/user/me/export');
    check('export requires auth', noAuthExport.status === 401);
    const exportRes = await req('GET', '/api/user/me/export', { token: 'tokExists' });
    check('export returns the account\'s own data', exportRes.status === 200 && exportRes.json.email === 'exists@x.com', exportRes.body);
    check('export includes saved_resumes', Array.isArray(exportRes.json.saved_resumes) && exportRes.json.saved_resumes.length === 1);
    check('export includes check_ins', Array.isArray(exportRes.json.check_ins) && exportRes.json.check_ins.length === 1);
    check('export never includes the password hash', JSON.stringify(exportRes.json).indexOf('password_hash') === -1 || !exportRes.json.account.password_hash);

    // ── Account deletion ──────────────────────────────────────────────────────
    const noAuthDelete = await req('DELETE', '/api/user/me', { body: { password: 'whatever' } });
    check('delete requires auth', noAuthDelete.status === 401);
    const wrongPwDelete = await req('DELETE', '/api/user/me', { token: 'tokExists', body: { password: 'not-the-password' } });
    check('delete rejects the wrong password (bearer token alone is not enough)', wrongPwDelete.status === 401, wrongPwDelete.body);
    check('account still exists after a wrong-password delete attempt', !!db.prepare('SELECT 1 FROM users WHERE email=?').get('exists@x.com'));

    const realDelete = await req('DELETE', '/api/user/me', { token: 'tokExists', body: { password: 'Correct-Horse-1!' } });
    check('delete succeeds with the correct password', realDelete.status === 200 && realDelete.json.success === true, realDelete.body);
    check('users row is gone', !db.prepare('SELECT 1 FROM users WHERE email=?').get('exists@x.com'));
    check('saved_resumes rows are gone', db.prepare('SELECT COUNT(*) c FROM saved_resumes WHERE email=?').get('exists@x.com').c === 0);
    check('check_ins row is gone', !db.prepare('SELECT 1 FROM check_ins WHERE email=?').get('exists@x.com'));
    check('session is revoked', !db.prepare('SELECT 1 FROM sessions WHERE token=?').get('tokExists'));
    const useOldToken = await req('GET', '/api/auth/me', { token: 'tokExists' });
    check('the old bearer token no longer authenticates anything', useOldToken.status === 401);
    check('account deletion was audit-logged (survives the account it describes)', !!db.prepare("SELECT 1 FROM audit_log WHERE action='user.account_deleted' AND actor_email='exists@x.com'").get());

  } catch (e) {
    console.error('FATAL', e);
    failures++;
  } finally {
    server.close();
    if (failures) { console.log(`\n${failures} FAILURE(S)`); process.exit(1); }
    console.log('\nALL PASS');
  }
});
