#!/usr/bin/env node
/**
 * Employer Portal — module engine, RBAC, tier gating & collaboration (HTTP).
 *
 * Boots the real Express app against a throwaway SQLite DB and drives the
 * /api/portal/* routes end to end: context resolution, the Scale "activate up
 * to 5, then 403 forever" rule, generic module-record CRUD with role-based
 * access control, cross-company isolation, CSV export, manager analytics, the
 * Base Collaboration Layer (directory / calendar / chat / copilot) and seat
 * limits. No network — the AI copilot exercises its deterministic fallback.
 *
 * Usage: node test/employer-portal-modules.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-pm-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY; // force copilot fallback
const { app } = require('../server.js');
const Database = require('better-sqlite3');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
function user(email, token) {
  db.prepare('INSERT OR IGNORE INTO users (email,username,password_hash) VALUES (?,?,?)').run(email, email.split('@')[0], 'x');
  db.prepare('INSERT OR IGNORE INTO sessions (token,email) VALUES (?,?)').run(token, email);
}
function employer(email, tier) {
  db.prepare("INSERT OR REPLACE INTO employer_subscribers (email, customer_id, tier, status) VALUES (?,?,?,'active')").run(email, 'cus_' + email, tier);
  db.prepare('INSERT OR IGNORE INTO employer_profiles (email, company_name, created_at, jobs_posted_lifetime) VALUES (?,?,?,0)').run(email, email.split('@')[0] + ' Co', Date.now());
}
function member(owner, email, role) {
  db.prepare('INSERT OR IGNORE INTO company_members (owner_email, member_email, name, role, status, invited_at) VALUES (?,?,?,?,?,?)').run(owner, email, email.split('@')[0], role, 'active', Date.now());
}

// Corporate company: admin + manager + employee.
user('corp@acme.com', 'tCorp'); employer('corp@acme.com', 'corporate');
user('mgr@acme.com', 'tMgr'); member('corp@acme.com', 'mgr@acme.com', 'manager');
user('emp@acme.com', 'tEmp'); member('corp@acme.com', 'emp@acme.com', 'employee');
// Scale company (owns nothing activated yet).
user('scale@co.com', 'tScale'); employer('scale@co.com', 'scale');
// Employer-Portal (pro) company — no operational modules, for 402 gating + seats.
user('pro@co.com', 'tPro'); employer('pro@co.com', 'pro');
// An outsider with no company at all.
user('nobody@x.com', 'tNobody');

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
    // ── context + auth ────────────────────────────────────────────────────────
    check('portal context requires auth', (await req('GET', '/api/portal/context')).status === 401);
    check('a user with no company is refused (403 not_in_company)', (await req('GET', '/api/portal/context', 'tNobody')).status === 403);
    const corpCtx = await req('GET', '/api/portal/context', 'tCorp');
    check('corporate admin context: 21 active modules, collab on', corpCtx.status === 200 && corpCtx.json.role === 'admin' && corpCtx.json.tier === 'corporate' && corpCtx.json.activeModules.length === 21 && corpCtx.json.collabActive === true, corpCtx.body);
    const mgrCtx = await req('GET', '/api/portal/context', 'tMgr');
    check('manager resolves into the same company with role manager', mgrCtx.json.role === 'manager' && mgrCtx.json.companyName === corpCtx.json.companyName);
    const scaleCtx = await req('GET', '/api/portal/context', 'tScale');
    check('scale starts with 0 active modules, 5 remaining', scaleCtx.json.activeModules.length === 0 && scaleCtx.json.scaleRemaining === 5);

    // ── Scale activation: up to 5, then locked forever (403) ─────────────────
    const picks = ['handbook', 'compliance', 'onboarding', 'incidents', 'timeclock'];
    for (const k of picks) {
      const r = await req('POST', '/api/portal/modules/activate', 'tScale', { moduleKey: k });
      check('scale activates ' + k, r.status === 200, r.body);
    }
    const sixth = await req('POST', '/api/portal/modules/activate', 'tScale', { moduleKey: 'expenses' });
    check('scale 6th module → 403 scale_cap', sixth.status === 403 && sixth.json.error === 'scale_cap' && /5 modules/.test(sixth.json.message), sixth.body);
    const scaleCtx2 = await req('GET', '/api/portal/context', 'tScale');
    check('scale now shows 5 active, 0 remaining', scaleCtx2.json.activeModules.length === 5 && scaleCtx2.json.scaleRemaining === 0);
    check('a non-admin cannot activate modules', (await req('POST', '/api/portal/modules/activate', 'tMgr', { moduleKey: 'ats' })).status === 403);

    // ── module records + RBAC ────────────────────────────────────────────────
    const badRec = await req('POST', '/api/portal/modules/handbook/records', 'tCorp', { category: 'Leave' });
    check('rejects a record missing required fields', badRec.status === 400 && Array.isArray(badRec.json.messages), badRec.body);
    const rec1 = await req('POST', '/api/portal/modules/handbook/records', 'tCorp', { title: 'Leave Policy', category: 'Leave', body: 'Take leave.' });
    check('admin creates a handbook record', rec1.status === 200 && Number.isInteger(rec1.json.id), rec1.body);
    const mgrList = await req('GET', '/api/portal/modules/handbook/records', 'tMgr');
    check('manager can read the handbook record', mgrList.status === 200 && mgrList.json.records.length === 1);
    // Employee: handbook is read-only for them.
    const empRead = await req('GET', '/api/portal/modules/handbook/records', 'tEmp');
    check('employee can read handbook (read-capability)', empRead.status === 200 && empRead.json.permissions.write === false);
    const empWriteHandbook = await req('POST', '/api/portal/modules/handbook/records', 'tEmp', { title: 'Sneaky' });
    check('employee cannot write handbook (403)', empWriteHandbook.status === 403);
    // Employee CAN submit an expense, and only sees their own.
    const empExp = await req('POST', '/api/portal/modules/expenses/records', 'tEmp', { title: 'Taxi', amount: '20' });
    check('employee submits their own expense', empExp.status === 200, empExp.body);
    const adminExp = await req('POST', '/api/portal/modules/expenses/records', 'tCorp', { title: 'Hotel', amount: '200' });
    check('admin adds an expense too', adminExp.status === 200);
    const empExpList = await req('GET', '/api/portal/modules/expenses/records', 'tEmp');
    check('employee sees ONLY their own expense (own-only scope)', empExpList.json.records.length === 1 && empExpList.json.records[0].data.amount === 20);
    const mgrExpList = await req('GET', '/api/portal/modules/expenses/records', 'tMgr');
    check('manager sees all expenses in the company', mgrExpList.json.records.length === 2);
    // Employee cannot delete the admin's expense (not own, no manage).
    const adminExpId = mgrExpList.json.records.find(r => r.data.amount === 200).id;
    check('employee cannot delete an expense they did not create', (await req('DELETE', '/api/portal/modules/expenses/records/' + adminExpId, 'tEmp')).status === 403);
    // Manager approves (status change on someone else's record — manage perm).
    const approve = await req('PATCH', '/api/portal/modules/expenses/records/' + empExpList.json.records[0].id, 'tMgr', { status: 'approved' });
    check('manager can approve an employee expense', approve.status === 200, approve.body);

    // ── tier gating: pro/free has no operational modules (402) ───────────────
    const proRec = await req('GET', '/api/portal/modules/handbook/records', 'tPro');
    check('Employer-Portal (pro) tier: modules locked → 402', proRec.status === 402 && proRec.json.error === 'module_not_active', proRec.body);
    // scale company: a module it did NOT pick → 403 (has some, not this).
    const scaleUnpicked = await req('GET', '/api/portal/modules/ats/records', 'tScale');
    check('scale, an unpicked module → 403', scaleUnpicked.status === 403, scaleUnpicked.body);
    const scalePicked = await req('GET', '/api/portal/modules/handbook/records', 'tScale');
    check('scale, a picked module → 200', scalePicked.status === 200);

    // ── cross-company isolation ──────────────────────────────────────────────
    const scaleSeesCorp = await req('GET', '/api/portal/modules/handbook/records', 'tScale');
    check('scale company cannot see corporate records', scaleSeesCorp.json.records.length === 0);

    // ── CSV export + analytics (manager+) ────────────────────────────────────
    const csv = await req('GET', '/api/portal/modules/expenses/export.csv', 'tMgr');
    check('manager can export a module as CSV', csv.status === 200 && /Title,Status/.test(csv.body), csv.body.slice(0, 60));
    check('employee cannot export CSV', (await req('GET', '/api/portal/modules/expenses/export.csv', 'tEmp')).status === 403);
    const an = await req('GET', '/api/portal/analytics', 'tMgr');
    check('manager analytics returns KPIs', an.status === 200 && an.json.kpis && typeof an.json.kpis.totalRecords === 'number', an.body);
    check('employee cannot see manager analytics', (await req('GET', '/api/portal/analytics', 'tEmp')).status === 403);

    // ── Base Collaboration Layer ─────────────────────────────────────────────
    const dir = await req('GET', '/api/portal/directory', 'tEmp');
    check('directory lists the company (admin + members)', dir.status === 200 && dir.json.directory.length >= 3, dir.body);
    const calPost = await req('POST', '/api/portal/calendar', 'tMgr', { title: 'All-hands', at: Date.now() });
    check('manager can add a calendar event', calPost.status === 200);
    check('employee cannot add a calendar event (manager+)', (await req('POST', '/api/portal/calendar', 'tEmp', { title: 'x' })).status === 403);
    const calList = await req('GET', '/api/portal/calendar', 'tEmp');
    check('employee can read the calendar', calList.status === 200 && calList.json.items.length === 1);
    const chat = await req('POST', '/api/portal/chat', 'tEmp', { body: 'Hello team' });
    check('any member can post to chat', chat.status === 200 && chat.json.message.body === 'Hello team', chat.body);
    const copilot = await req('POST', '/api/portal/copilot', 'tMgr', { question: 'How are we doing on hiring?' });
    check('copilot answers (deterministic fallback, no key)', copilot.status === 200 && copilot.json.grounded === false && /records/.test(copilot.json.answer), copilot.body);
    check('collab is locked for pro tier (402)', (await req('GET', '/api/portal/directory', 'tPro')).status === 402);

    // ── members / seats ──────────────────────────────────────────────────────
    const addMember = await req('POST', '/api/portal/members', 'tCorp', { email: 'newhire@acme.com', name: 'New Hire', role: 'employee' });
    check('admin can add a member', addMember.status === 200, addMember.body);
    check('a duplicate member is rejected (409)', (await req('POST', '/api/portal/members', 'tCorp', { email: 'newhire@acme.com' })).status === 409);
    check('a bad email is rejected', (await req('POST', '/api/portal/members', 'tCorp', { email: 'nope' })).status === 400);
    check('a non-admin cannot add members', (await req('POST', '/api/portal/members', 'tMgr', { email: 'x@y.com' })).status === 403);
    // Pro tier seat cap = 5.
    for (let i = 0; i < 5; i++) await req('POST', '/api/portal/members', 'tPro', { email: `seat${i}@pro.co`, role: 'employee' });
    const overSeat = await req('POST', '/api/portal/members', 'tPro', { email: 'seat6@pro.co' });
    check('seat limit enforced on pro tier (403 seat_limit)', overSeat.status === 403 && overSeat.json.error === 'seat_limit', overSeat.body);

    console.log(failures ? `\nFAILED (${failures} failure${failures === 1 ? '' : 's'})` : '\nALL PASS (0 failures)');
    server.close(() => process.exit(failures ? 1 : 0));
  } catch (e) {
    console.error('THREW', e);
    server.close(() => process.exit(1));
  }
});
