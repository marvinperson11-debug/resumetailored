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
// A resume the account shared via /r/:slug, and an employer job posting +
// its job_feed mirror — both regression-test the two completeness gaps a
// security-review pass found in the first draft of account deletion.
db.prepare('INSERT INTO shared_resumes (slug,name,text,created_at,owner_email) VALUES (?,?,?,?,?)')
  .run('test-share-slug', 'Existing User', 'Shared resume text', Date.now(), 'exists@x.com');
db.prepare('INSERT INTO employer_profiles (email,company_name,created_at) VALUES (?,?,?)')
  .run('exists@x.com', 'Acme Test Co', Date.now());
db.prepare(`INSERT INTO job_postings (id,employer_email,title,location,work_mode,job_type,status,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)`).run(9001, 'exists@x.com', 'Test Job', 'Remote', 'remote', 'full_time', 'active', Date.now(), Date.now());
db.prepare(`INSERT INTO job_feed (source,external_id,title,company,location,url,posted_at,fetched_at)
            VALUES ('employer',?,?,?,?,?,?,?)`).run('9001', 'Test Job', 'Acme Test Co', 'Remote', '#job-9001', Date.now(), Date.now());

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

    // ── Login: a wrong password is NEVER a lockout ──────────────────────────
    // Product decision: mistyping your password tells you it was wrong, it does
    // not lock you out of your own account (see /api/auth/login in server.js).
    // Brute force stays bounded by authRateLimiter (20/15min); the hard 5-strike
    // lockout was removed because it locked out legitimate users.
    let lastFail;
    for (let i = 0; i < 8; i++) {
      lastFail = await req('POST', '/api/auth/login', { body: { email: 'exists@x.com', password: 'wrong-password' } });
    }
    check('repeated wrong passwords keep returning 401, never a 429 lockout', lastFail.status === 401, lastFail.body);
    check('the 401 says the credentials were wrong', /incorrect|invalid/i.test((lastFail.json && lastFail.json.error) || ''), lastFail.body);
    // The correct password still works right after several wrong tries — the
    // account is never locked, which is the whole point of the change.
    const correctAfterFails = await req('POST', '/api/auth/login', { body: { email: 'exists@x.com', password: 'Correct-Horse-1!' } });
    check('the correct password still logs in after repeated failures (no lockout)', correctAfterFails.status === 200 && !!correctAfterFails.json.token, correctAfterFails.body);

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
    check('export includes the account\'s shared /r/:slug resumes', Array.isArray(exportRes.json.sharedResumes) && exportRes.json.sharedResumes.length === 1 && exportRes.json.sharedResumes[0].slug === 'test-share-slug', exportRes.body);
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
    check('shared /r/:slug resume is gone (a security-review finding: this used to survive deletion)', !db.prepare('SELECT 1 FROM shared_resumes WHERE slug=?').get('test-share-slug'));
    check('job_postings row is gone', !db.prepare('SELECT 1 FROM job_postings WHERE id=?').get(9001));
    check('its job_feed mirror is gone too (a security-review finding: this used to survive deletion, orphaned but still served)', !db.prepare("SELECT 1 FROM job_feed WHERE source='employer' AND external_id=?").get('9001'));
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
