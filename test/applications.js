#!/usr/bin/env node
/**
 * Job Application Tracker — HTTP route integration.
 *
 * Boots the real Express app against a throwaway SQLite DB and drives every
 * /api/applications route end to end: auth gating, CRUD, the free 20-app cap,
 * per-user isolation, stats aggregation, CSV export (Pro-only), and auto-fill
 * (Pro-only). No network or API budget is used.
 *
 * Usage: node test/applications.js
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

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-apps-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
const Database = require('better-sqlite3');

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('free@x.com', 'Freddy Free', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokFree', 'free@x.com');
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('pro@x.com', 'Prya Pro', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokPro', 'pro@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('pro@x.com', 'cPro');
// A saved job for the Pro user, to exercise auto-fill.
db.prepare('INSERT INTO saved_jobs (email,job_id,title,company,location,url,snapshot,saved_at) VALUES (?,?,?,?,?,?,?,?)')
  .run('pro@x.com', 'j1', 'Staff Engineer', 'Stripe', 'Remote', 'https://stripe.com/jobs/1', '{}', Date.now());

function req(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
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
    // ── auth gate ────────────────────────────────────────────────────────────
    check('GET list requires auth', (await req('GET', '/api/applications')).status === 401);
    check('POST requires auth', (await req('POST', '/api/applications', null, { company: 'X', jobTitle: 'Y' })).status === 401);
    check('stats requires auth', (await req('GET', '/api/applications/stats')).status === 401);
    check('export requires auth', (await req('GET', '/api/applications/export')).status === 401);
    check('PUT requires auth', (await req('PUT', '/api/applications/1')).status === 401);
    check('DELETE requires auth', (await req('DELETE', '/api/applications/1')).status === 401);

    // ── create + validation ───────────────────────────────────────────────────
    const bad = await req('POST', '/api/applications', 'tokFree', { company: '', jobTitle: '' });
    check('POST rejects missing company/title', bad.status === 400, bad.body);

    const created = await req('POST', '/api/applications', 'tokFree', {
      company: 'Acme', jobTitle: 'Frontend Engineer', location: 'NYC', status: 'Applied',
      applicationUrl: 'https://acme.com/jobs/1', notes: 'Referred by a friend',
    });
    check('POST creates an application', created.status === 200 && created.json.application && created.json.application.id > 0, created.body);
    const appId = created.json.application.id;
    check('created app echoes fields', created.json.application.company === 'Acme' && created.json.application.jobTitle === 'Frontend Engineer');

    const blankDate = await req('POST', '/api/applications', 'tokFree', { company: 'B', jobTitle: 'B' });
    check('date_applied defaults to today when blank', /^\d{4}-\d{2}-\d{2}$/.test(blankDate.json.application.dateApplied), blankDate.body);

    const badStatus = await req('POST', '/api/applications', 'tokFree', { company: 'C', jobTitle: 'C', status: 'Nonsense' });
    check('invalid status falls back to Applied', badStatus.json.application.status === 'Applied', badStatus.body);

    // ── list ──────────────────────────────────────────────────────────────────
    const list = await req('GET', '/api/applications', 'tokFree');
    check('GET list returns rows for the user', list.json.applications.length === 3, list.body);
    check('list reports free (not pro) + limit 20', list.json.isPro === false && list.json.limit === 20);
    check('list exposes the status vocabulary', Array.isArray(list.json.statuses) && list.json.statuses.includes('Ghosted'));

    // ── update ─────────────────────────────────────────────────────────────────
    const upd = await req('PUT', '/api/applications/' + appId, 'tokFree', { status: 'Interview', notes: 'Round 2 booked' });
    check('PUT updates status + notes', upd.status === 200 && upd.json.application.status === 'Interview' && upd.json.application.notes === 'Round 2 booked', upd.body);
    const updBadStatus = await req('PUT', '/api/applications/' + appId, 'tokFree', { status: 'Bogus' });
    check('PUT ignores an invalid status', updBadStatus.json.application.status === 'Interview');
    check('PUT 404 on unknown id', (await req('PUT', '/api/applications/999999', 'tokFree', { status: 'Offer' })).status === 404);

    // ── stats ──────────────────────────────────────────────────────────────────
    const stats = await req('GET', '/api/applications/stats', 'tokFree');
    check('stats: total is 3', stats.json.total === 3, stats.body);
    check('stats: interviews counts the moved app', stats.json.interviews === 1, stats.body);
    check('stats: weekly has 8 buckets', Array.isArray(stats.json.weekly) && stats.json.weekly.length === 8);
    check('stats: free user gets NO advanced block', stats.json.advanced === undefined);

    // ── Pro gating: export + autofill ──────────────────────────────────────────
    check('free export is 403', (await req('GET', '/api/applications/export', 'tokFree')).status === 403);
    check('free autofill is 403', (await req('GET', '/api/applications/autofill/jobs', 'tokFree')).status === 403);

    // Pro user
    const proCreate = await req('POST', '/api/applications', 'tokPro', { company: 'Stripe', jobTitle: 'Staff Eng', status: 'Offer' });
    check('pro can create', proCreate.status === 200, proCreate.body);
    const proExport = await req('GET', '/api/applications/export', 'tokPro');
    check('pro export is 200 CSV', proExport.status === 200 && /Company,Job Title/.test(proExport.body), proExport.body.slice(0, 80));
    const proStats = await req('GET', '/api/applications/stats', 'tokPro');
    check('pro stats include advanced analytics', proStats.json.advanced && typeof proStats.json.advanced.byStatus === 'object', proStats.body);
    const autofill = await req('GET', '/api/applications/autofill/jobs', 'tokPro');
    check('pro autofill returns saved jobs', autofill.status === 200 && autofill.json.jobs.length === 1 && autofill.json.jobs[0].company === 'Stripe', autofill.body);

    // ── per-user isolation ─────────────────────────────────────────────────────
    check("pro cannot see free user's apps in list", (await req('GET', '/api/applications', 'tokPro')).json.applications.every(a => a.company !== 'Acme'));
    check("free cannot update pro's app", (await req('PUT', '/api/applications/' + proCreate.json.application.id, 'tokFree', { status: 'Rejected' })).status === 404);
    check("free cannot delete pro's app", (await req('DELETE', '/api/applications/' + proCreate.json.application.id, 'tokFree')).status === 404);

    // ── free 20-cap ────────────────────────────────────────────────────────────
    // The free user already has 3. Add up to 20, then the 21st must 403.
    let capHit = false, lastOkCount = 0;
    for (let i = 0; i < 30; i++) {
      const r = await req('POST', '/api/applications', 'tokFree', { company: 'Cap' + i, jobTitle: 'Role' + i });
      if (r.status === 403) { capHit = true; break; }
      if (r.status === 200) lastOkCount++;
    }
    check('free cap blocks the 21st application with 403', capHit, 'lastOkCount=' + lastOkCount);
    const capList = await req('GET', '/api/applications', 'tokFree');
    check('free user capped at exactly 20 rows', capList.json.count === 20 && capList.json.atLimit === true, 'count=' + capList.json.count);

    // Pro is unlimited — can exceed 20.
    for (let i = 0; i < 25; i++) await req('POST', '/api/applications', 'tokPro', { company: 'P' + i, jobTitle: 'R' + i });
    const proList = await req('GET', '/api/applications', 'tokPro');
    check('pro is unlimited (>20 rows allowed)', proList.json.count > 20 && proList.json.atLimit === false, 'count=' + proList.json.count);

    // ── delete ─────────────────────────────────────────────────────────────────
    check('DELETE removes an app', (await req('DELETE', '/api/applications/' + appId, 'tokFree')).status === 200);
    check('DELETE 404 on already-deleted', (await req('DELETE', '/api/applications/' + appId, 'tokFree')).status === 404);

  } catch (e) {
    console.error('ERROR', e && e.stack ? e.stack : e);
    failures++;
  } finally {
    server.close();
    if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
    else console.log('\nALL PASS');
  }
});
