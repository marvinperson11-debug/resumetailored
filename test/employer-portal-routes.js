#!/usr/bin/env node
/**
 * Employer Portal — HTTP route integration (Phase A: foundation).
 *
 * Boots the real Express app against a throwaway SQLite DB and drives the
 * /api/employer routes end to end: Hire Mode profile setup, job posting CRUD,
 * free-tier active-post cap, Pro Employer gating, and cross-account isolation
 * (one employer can never see/edit another's postings). No Stripe/network
 * calls — /api/employer/subscribe is checked only for its "not configured"
 * fallback, matching how the lifetime-plan route is tested elsewhere.
 *
 * Usage: node test/employer-portal-routes.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-ep-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
const Database = require('better-sqlite3');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('boss@acme.com', 'Boss', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokBoss', 'boss@acme.com');
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('rival@other.com', 'Rival', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokRival', 'rival@other.com');

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

const goodJob = { title: 'Registered Nurse', description: 'Full-time RN role in a busy ICU with great benefits.', requirements: 'BLS', location: 'Chicago, IL', workMode: 'onsite', jobType: 'full-time', salaryMin: '70000', salaryMax: '90000' };

let PORT;
const server = app.listen(0, async () => {
  PORT = server.address().port;
  try {
    // ── auth gate ────────────────────────────────────────────────────────────
    check('status requires auth', (await req('GET', '/api/employer/status')).status === 401);
    check('posting a job requires auth', (await req('POST', '/api/employer/jobs', null, goodJob)).status === 401);

    // ── not an employer yet ──────────────────────────────────────────────────
    const s0 = await req('GET', '/api/employer/status', 'tokBoss');
    check('status before setup: not an employer', s0.status === 200 && s0.json.isEmployer === false, s0.body);
    const preJob = await req('POST', '/api/employer/jobs', 'tokBoss', goodJob);
    check('cannot post a job before a company profile exists', preJob.status === 400 && preJob.json.error === 'no_employer_profile', preJob.body);

    // ── Hire Mode / profile setup ────────────────────────────────────────────
    const badProfile = await req('POST', '/api/employer/profile', 'tokBoss', { companyName: 'A' });
    check('rejects a too-short company name', badProfile.status === 400);
    const setProfile = await req('POST', '/api/employer/profile', 'tokBoss', { companyName: 'Acme Health', website: 'https://acme.health' });
    check('creates the employer profile', setProfile.status === 200 && setProfile.json.companyName === 'Acme Health', setProfile.body);
    const s1 = await req('GET', '/api/employer/status', 'tokBoss');
    check('status after setup: is an employer, not Pro, 0 active jobs', s1.json.isEmployer === true && s1.json.pro === false && s1.json.activeJobs === 0);
    check('free active-post limit surfaced', s1.json.freeActiveJobLimit === 3);

    // ── posting jobs + validation ────────────────────────────────────────────
    const badPost = await req('POST', '/api/employer/jobs', 'tokBoss', Object.assign({}, goodJob, { title: '' }));
    check('rejects an invalid job posting', badPost.status === 400 && Array.isArray(badPost.json.errors));
    const p1 = await req('POST', '/api/employer/jobs', 'tokBoss', goodJob);
    check('posts a valid job', p1.status === 200 && Number.isInteger(p1.json.id), p1.body);
    const list1 = await req('GET', '/api/employer/jobs', 'tokBoss');
    check('job list returns the posted job with 0 applicants', list1.json.jobs.length === 1 && list1.json.jobs[0].applicantCount === 0);
    check('job list carries gig fields as null for a non-gig posting', list1.json.jobs[0].isGig === false && list1.json.jobs[0].gigRate === null);

    // ── temp/gig posting ──────────────────────────────────────────────────────
    const gigPost = await req('POST', '/api/employer/jobs', 'tokBoss', Object.assign({}, goodJob, { title: 'Event Staff', jobType: 'temp', gigRate: '25', gigSchedule: 'Sat 9am-5pm' }));
    check('posts a temp/gig job', gigPost.status === 200);
    const list2 = await req('GET', '/api/employer/jobs', 'tokBoss');
    const gigJob = list2.json.jobs.find(j => j.title === 'Event Staff');
    check('gig job carries isGig + rate + schedule', gigJob && gigJob.isGig === true && gigJob.gigRate === 25 && gigJob.gigSchedule === 'Sat 9am-5pm');

    // ── free tier active-post cap (3) ────────────────────────────────────────
    await req('POST', '/api/employer/jobs', 'tokBoss', Object.assign({}, goodJob, { title: 'Job 3' }));
    const capped = await req('POST', '/api/employer/jobs', 'tokBoss', Object.assign({}, goodJob, { title: 'Job 4 over cap' }));
    check('free plan blocks a 4th active post', capped.status === 402 && capped.json.error === 'quota', capped.body);

    // ── editing ───────────────────────────────────────────────────────────────
    const editBad = await req('PUT', '/api/employer/jobs/' + p1.json.id, 'tokBoss', { title: '' });
    check('rejects an invalid edit', editBad.status === 400);
    const editOk = await req('PUT', '/api/employer/jobs/' + p1.json.id, 'tokBoss', Object.assign({}, goodJob, { title: 'Senior RN' }));
    check('edits a job', editOk.status === 200);
    const listAfterEdit = await req('GET', '/api/employer/jobs', 'tokBoss');
    check('edit persisted', listAfterEdit.json.jobs.some(j => j.title === 'Senior RN'));

    // ── close / reopen (status-only PUT) ─────────────────────────────────────
    const closeIt = await req('PUT', '/api/employer/jobs/' + p1.json.id, 'tokBoss', { status: 'closed' });
    check('closes a job via status-only update', closeIt.status === 200 && closeIt.json.status === 'closed');
    const sAfterClose = await req('GET', '/api/employer/status', 'tokBoss');
    check('closing a post frees up the active-post cap', sAfterClose.json.activeJobs === 2, String(sAfterClose.json.activeJobs));
    // Cap was full with 3 active before closing one — now there's room again.
    const afterCloseCanPost = await req('POST', '/api/employer/jobs', 'tokBoss', Object.assign({}, goodJob, { title: 'Job 5 after close' }));
    check('posting works again after closing one to free the cap', afterCloseCanPost.status === 200, afterCloseCanPost.body);

    // ── cross-account isolation ───────────────────────────────────────────────
    const rivalList = await req('GET', '/api/employer/jobs', 'tokRival');
    check('a different employer sees an empty job list (no profile yet)', rivalList.status === 200 && rivalList.json.jobs.length === 0);
    const rivalEdit = await req('PUT', '/api/employer/jobs/' + p1.json.id, 'tokRival', goodJob);
    check("a different employer cannot edit someone else's job", rivalEdit.status === 404);
    const rivalDelete = await req('DELETE', '/api/employer/jobs/' + p1.json.id, 'tokRival');
    check("a different employer cannot delete someone else's job", rivalDelete.status === 404);

    // ── delete ────────────────────────────────────────────────────────────────
    const del = await req('DELETE', '/api/employer/jobs/' + p1.json.id, 'tokBoss');
    check('deletes a job', del.status === 200);
    const listAfterDelete = await req('GET', '/api/employer/jobs', 'tokBoss');
    check('deleted job is gone', !listAfterDelete.json.jobs.some(j => j.id === p1.json.id));

    // ── Pro Employer gating ───────────────────────────────────────────────────
    db.prepare('INSERT INTO employer_subscribers (email, customer_id) VALUES (?,?)').run('boss@acme.com', 'cus_employer_1');
    const sPro = await req('GET', '/api/employer/status', 'tokBoss');
    check('Pro Employer status flips pro:true', sPro.json.pro === true);
    // Fill well past the free cap — should never 402 once Pro.
    for (let i = 0; i < 5; i++) await req('POST', '/api/employer/jobs', 'tokBoss', Object.assign({}, goodJob, { title: 'Pro overflow ' + i }));
    const stillOk = await req('POST', '/api/employer/jobs', 'tokBoss', Object.assign({}, goodJob, { title: 'Pro overflow final' }));
    check('Pro Employer is never capped', stillOk.status === 200, stillOk.body);

    // ── checkout fallback when unconfigured ──────────────────────────────────
    const checkout = await req('POST', '/api/employer/subscribe', 'tokRival');
    check('checkout fails gracefully with no STRIPE_EMPLOYER_PRICE_ID configured', checkout.status === 503 && checkout.json.error === 'not_configured');

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
