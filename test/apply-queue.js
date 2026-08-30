#!/usr/bin/env node
/**
 * AutoApply queue — persistent, cross-device server-side queue (HTTP routes).
 *
 * Boots the real Express app against a throwaway SQLite DB and drives every
 * /api/apply-queue route end to end: auth gating, add/dedupe, batch, list +
 * status filter, patch (status/formData/coverLetter), delete, count, job-board
 * inference, per-user isolation, and — the point of the feature — CROSS-DEVICE
 * SYNC: a job added on one session of a user is visible on another session of
 * the same user. No network or LLM calls.
 *
 * Usage: node test/apply-queue.js
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

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-aaq-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
process.env.RT_SERVICE_TOKEN = 'test-service-secret'; // enables the AutoApply service bridge
const { app } = require('../server.js');
const Database = require('better-sqlite3');

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
// One user with TWO sessions (two devices), plus a second user for isolation.
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('sync@x.com', 'Sy Nc', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('devA', 'sync@x.com');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('devB', 'sync@x.com');
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('other@x.com', 'Oth Er', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokOther', 'other@x.com');

function req(method, urlPath, token, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = Object.assign({}, extraHeaders || {});
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
    // ── auth gate: every route requires an account ─────────────────────────────
    check('GET queue requires auth', (await req('GET', '/api/apply-queue')).status === 401);
    check('POST queue requires auth', (await req('POST', '/api/apply-queue', null, { job_url: 'x' })).status === 401);
    check('PATCH queue requires auth', (await req('PATCH', '/api/apply-queue/1', null, { status: 'archived' })).status === 401);
    check('DELETE queue requires auth', (await req('DELETE', '/api/apply-queue/1', null)).status === 401);
    check('count requires auth', (await req('GET', '/api/apply-queue/count')).status === 401);

    // ── add a job ──────────────────────────────────────────────────────────────
    const add = await req('POST', '/api/apply-queue', 'devA', {
      job_url: 'https://www.linkedin.com/jobs/view/123', job_title: 'RN', company_name: 'Mercy'
    });
    check('POST add → 201 created', add.status === 201 && add.json.created === true, add.body);
    check('add returns status queued', add.json.item && add.json.item.status === 'queued');
    check('job_board inferred from URL (linkedin)', add.json.item && add.json.item.jobBoard === 'linkedin', add.json.item && add.json.item.jobBoard);
    const itemId = add.json.item.id;

    // ── dedupe: same job_url again is a no-op (created:false, 200) ──────────────
    const dupe = await req('POST', '/api/apply-queue', 'devA', { job_url: 'https://www.linkedin.com/jobs/view/123', job_title: 'RN' });
    check('POST duplicate job_url → 200 created:false', dupe.status === 200 && dupe.json.created === false, dupe.body);

    // ── validation: empty add rejected ─────────────────────────────────────────
    check('POST with no url/title → 400', (await req('POST', '/api/apply-queue', 'devA', {})).status === 400);

    // ── CROSS-DEVICE SYNC: added on devA, visible on devB (same user) ──────────
    const onB = await req('GET', '/api/apply-queue', 'devB');
    check('CROSS-DEVICE: job added on devA appears on devB', onB.status === 200 && onB.json.items.some(i => i.id === itemId), onB.body);
    check('count reflects the queue on devB', (await req('GET', '/api/apply-queue/count', 'devB')).json.count === 1);

    // ── per-user isolation: a different user sees nothing ──────────────────────
    const otherList = await req('GET', '/api/apply-queue', 'tokOther');
    check('ISOLATION: other user does not see the job', otherList.status === 200 && otherList.json.items.length === 0, otherList.body);

    // ── batch add ──────────────────────────────────────────────────────────────
    const batch = await req('POST', '/api/apply-queue/batch', 'devA', { jobs: [
      { job_url: 'https://boards.greenhouse.io/acme/jobs/1', job_title: 'Dev' },
      { job_url: 'https://jobs.lever.co/acme/2', job_title: 'PM' },
      { job_url: 'https://www.linkedin.com/jobs/view/123' } // duplicate of the first add
    ] });
    check('batch → 201, 2 newly created (dupe skipped)', batch.status === 201 && batch.json.created === 2, batch.body);
    check('batch infers greenhouse + lever boards', batch.json.items.some(i => i.jobBoard === 'greenhouse') && batch.json.items.some(i => i.jobBoard === 'lever'));
    check('empty batch → 400', (await req('POST', '/api/apply-queue/batch', 'devA', { jobs: [] })).status === 400);

    // ── list + status filter ───────────────────────────────────────────────────
    const all = await req('GET', '/api/apply-queue', 'devA');
    check('list has all 3 items', all.json.count === 3, all.body);

    // ── patch status ───────────────────────────────────────────────────────────
    const patched = await req('PATCH', '/api/apply-queue/' + itemId, 'devA', { status: 'submitted', formData: { name: 'Jane' } });
    check('PATCH status + formData → 200', patched.status === 200 && patched.json.item.status === 'submitted', patched.body);
    check('PATCH persisted formData', patched.json.item.formData && patched.json.item.formData.name === 'Jane');
    check('PATCH invalid status → 400', (await req('PATCH', '/api/apply-queue/' + itemId, 'devA', { status: 'nope' })).status === 400);
    check('PATCH missing item → 404', (await req('PATCH', '/api/apply-queue/999999', 'devA', { status: 'archived' })).status === 404);

    const submitted = await req('GET', '/api/apply-queue?status=submitted', 'devB');
    check('status filter returns the submitted one only', submitted.json.count === 1 && submitted.json.items[0].id === itemId, submitted.body);

    // ── isolation on writes: other user cannot patch/delete my item ────────────
    check('ISOLATION: other user PATCH my item → 404', (await req('PATCH', '/api/apply-queue/' + itemId, 'tokOther', { status: 'archived' })).status === 404);
    const delByOther = await req('DELETE', '/api/apply-queue/' + itemId, 'tokOther');
    check('ISOLATION: other user DELETE is a no-op for my item', delByOther.status === 200 && (await req('GET', '/api/apply-queue/count', 'devA')).json.count === 3);

    // ── delete ──────────────────────────────────────────────────────────────────
    await req('DELETE', '/api/apply-queue/' + itemId, 'devA');
    check('DELETE removes the item (visible cross-device)', (await req('GET', '/api/apply-queue/count', 'devB')).json.count === 2);

    // ── SERVICE-TOKEN BRIDGE: the standalone AutoApply app authenticates by a
    //    shared secret + the user's email (no shared session store) ──────────────
    const SVC = { 'x-rt-service-token': 'test-service-secret', 'x-rt-user-email': 'sync@x.com' };
    const svcGet = await req('GET', '/api/apply-queue', null, null, SVC);
    check('SERVICE: valid token+email reads the same user queue', svcGet.status === 200 && svcGet.json.count === 2, svcGet.body);
    const svcAdd = await req('POST', '/api/apply-queue', null, { job_url: 'https://jobs.example.com/svc-1', job_title: 'Via Service' }, SVC);
    check('SERVICE: can add to the user queue', svcAdd.status === 201 && svcAdd.json.item.jobTitle === 'Via Service', svcAdd.body);
    // The service-added job is visible to the same user's browser session.
    check('SERVICE: service-added job visible to the browser session', (await req('GET', '/api/apply-queue/count', 'devA')).json.count === 3);
    // Status write-back via the service bridge.
    const svcPatch = await req('PATCH', '/api/apply-queue/' + svcAdd.json.item.id, null, { status: 'auto_filled' }, SVC);
    check('SERVICE: can PATCH status back', svcPatch.status === 200 && svcPatch.json.item.status === 'auto_filled', svcPatch.body);
    // A wrong secret is rejected; a valid secret without an email header falls
    // through to normal session auth (which, unauthenticated, is 401).
    check('SERVICE: wrong token → 401 bad_service_token',
      (await req('GET', '/api/apply-queue', null, null, { 'x-rt-service-token': 'nope', 'x-rt-user-email': 'sync@x.com' })).json.error === 'bad_service_token');
    check('SERVICE: token without email header → session 401',
      (await req('GET', '/api/apply-queue', null, null, { 'x-rt-service-token': 'test-service-secret' })).status === 401);
    // Isolation still holds: a service call for one user never sees another's.
    check('SERVICE: scoped to the named email only',
      (await req('GET', '/api/apply-queue', null, null, { 'x-rt-service-token': 'test-service-secret', 'x-rt-user-email': 'other@x.com' })).json.count === 0);

    if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); server.close(() => process.exit(1)); }
    else { console.log('\nALL PASS (0 failures)'); server.close(() => process.exit(0)); }
  } catch (e) {
    console.error('THREW', e);
    server.close(() => process.exit(1));
  }
});
