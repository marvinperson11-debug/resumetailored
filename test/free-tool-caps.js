#!/usr/bin/env node
/**
 * Anonymous free-tool access with per-IP daily caps — the real routes, a mocked
 * Anthropic API.
 *
 * Boots the real Express app against a throwaway SQLite DB and points the
 * Anthropic SDK at a local mock (ANTHROPIC_BASE_URL), so the quota path runs end
 * to end — gate, reservation, refund, usage payload — with no network and no API
 * spend. Visitors are told apart by CF-Connecting-IP, exactly as in production.
 *
 *   guest      : jobDecode 3/day,  keywordExtract 10/day  (keyed by salted IP hash)
 *   free member: jobDecode 10/day, keywordExtract 30/day  (keyed by account)
 *   Pro        : unlimited
 *
 * Usage: node test/free-tool-caps.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const SALT = 'test-only-tools-hash-salt-0123456789';
const JD = 'We are hiring a Senior Product Manager for our B2B SaaS platform. You will own the roadmap, lead cross-functional teams across engineering, design and data, run discovery with customers, and ship measurable improvements. Requirements: 5+ years of product management, SQL, A/B testing, Agile/Scrum, stakeholder management, Jira, and strong written communication skills.';

// ── boot-time guard: no salt => the server must refuse to start ──────────────
function bootWith(env) {
  return spawnSync(process.execPath, ['-e', "require('./server.js'); setTimeout(() => process.exit(0), 50);"], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rt-caps-boot-')), PORT: '0', RT_DISABLE_RATE_LIMIT: '1', TOOLS_HASH_SALT: undefined }, env),
    encoding: 'utf8', timeout: 60000,
  });
}
{
  const none = bootWith({});
  check('boot: missing TOOLS_HASH_SALT => non-zero exit', none.status !== 0, `status=${none.status}`);
  check('boot: ...with a message naming the variable', /TOOLS_HASH_SALT/.test(String(none.stderr)), String(none.stderr).slice(0, 200));
  const weak = bootWith({ TOOLS_HASH_SALT: 'short' });
  check('boot: too-short salt is refused too', weak.status !== 0 && /TOOLS_HASH_SALT/.test(String(weak.stderr)));
}

// ── mock Anthropic ───────────────────────────────────────────────────────────
let mockMode = 'ok';       // 'ok' | 'fail'
let mockDelayMs = 0;
let mockCalls = 0;
const DECODE = { summary: 'A product role with real scope.', seniority: 'senior', redFlags: ['Vague scope'], greenFlags: ['Clear requirements'], hiddenRequirements: ['Travel'], salaryRange: { low: 140000, high: 175000, currency: 'USD', note: 'estimate' } };
const mock = http.createServer((rq, rs) => {
  let b = ''; rq.on('data', (c) => { b += c; });
  rq.on('end', () => {
    mockCalls++;
    let model = ''; try { model = JSON.parse(b).model || ''; } catch (e) {}
    setTimeout(() => {
      if (mockMode === 'fail') {
        rs.writeHead(400, { 'content-type': 'application/json' });
        return rs.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'mock failure' } }));
      }
      const text = /haiku/.test(model) ? JSON.stringify(DECODE) : JSON.stringify(['SQL', 'A/B testing', 'Agile', 'Jira', 'Roadmapping']);
      rs.writeHead(200, { 'content-type': 'application/json' });
      rs.end(JSON.stringify({ id: 'msg_mock', type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    }, mockDelayMs);
  });
});

mock.listen(0, '127.0.0.1', () => {
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'sk-test-mock';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-caps-'));
  process.env.RT_DISABLE_RATE_LIMIT = '1';
  process.env.TOOLS_HASH_SALT = SALT;
  run().catch((e) => { failures++; console.error('FAIL  test crashed —', e); }).finally(() => {
    mock.close();
    if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
    console.log('\nALL PASS'); process.exit(0);
  });
});

async function run() {
  const { app } = require('../server.js');
  const Database = require('better-sqlite3');
  const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
  db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('free@x.com', 'Freddy', 'x');
  db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokFree', 'free@x.com');
  db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('pro@x.com', 'Prya', 'x');
  db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokPro', 'pro@x.com');
  db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('pro@x.com', 'cPro');
  const rowsFor = (tool) => db.prepare('SELECT COUNT(*) c FROM tool_usage WHERE tool_name = ?').get(tool).c;
  const guestRows = () => db.prepare("SELECT user_email FROM tool_usage WHERE user_email LIKE 'guest-%'").all();

  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const PORT = server.address().port;
  function call(urlPath, body, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
      if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
      if (opts.ip) headers['CF-Connecting-IP'] = opts.ip;
      const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: 'POST', headers }, (res) => {
        let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; });
        res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, json: j || {}, body: b }); });
      });
      r.on('error', reject); r.write(payload); r.end();
    });
  }
  const extract = (opts) => call('/api/tools/extract-keywords', { jobDescription: JD }, opts);
  const decode = (opts) => call('/api/tools/job-description-decode', { jobText: JD }, opts);

  // ── Keyword extractor, guest: 10 successes then a soft-prompt 402 ──────────
  const G1 = { ip: '203.0.113.10' };
  let r, okCount = 0, last;
  for (let i = 0; i < 10; i++) { last = await extract(G1); if (last.status === 200) okCount++; }
  check('extractor: guest gets 10 successful runs', okCount === 10, `ok=${okCount}`);
  check('extractor: success carries keywords + usage {used,limit,guest}', Array.isArray(last.json.keywords) && last.json.keywords.length === 5 && last.json.usage && last.json.usage.used === 10 && last.json.usage.limit === 10 && last.json.usage.guest === true, last.body);
  r = await extract(G1);
  check('extractor: 11th guest run => 402', r.status === 402, r.body);
  check('extractor: 402 says guest:true, error quota, limit 10', r.json.error === 'quota' && r.json.guest === true && r.json.limit === 10 && r.json.period === 'day', r.body);
  check('extractor: guest 402 message does not promise an account will lift the cap', !/account/i.test(r.json.message || '') && /reset tomorrow/.test(r.json.message || '') && /Go Pro/.test(r.json.message || ''), r.json.message);
  check('extractor: a refused run is not billed to the model', mockCalls === 10, `mockCalls=${mockCalls}`);

  // ── Per-visitor keying (CF-Connecting-IP), salted identity ────────────────
  r = await extract({ ip: '203.0.113.11' });
  check('extractor: a different visitor IP has its own fresh allowance', r.status === 200 && r.json.usage.used === 1, r.body);
  r = await extract({ ip: '2001:db8:1:2:aaaa::1' });
  const r2 = await extract({ ip: '2001:db8:1:2:bbbb::9' });
  check('extractor: two addresses in one IPv6 /64 share an allowance', r.status === 200 && r2.status === 200 && r2.json.usage.used === 2, r2.body);
  const unsalted = 'guest-' + crypto.createHash('sha256').update('free-tools:203.0.113.10').digest('hex').slice(0, 24) + '@anonymous.local';
  const salted = 'guest-' + crypto.createHmac('sha256', SALT).update('free-tools:203.0.113.10').digest('hex').slice(0, 24) + '@anonymous.local';
  const ids = guestRows().map((x) => x.user_email);
  check('guest identity is the salted HMAC, never the plain SHA-256', ids.includes(salted) && !ids.includes(unsalted), ids[0]);
  check('guest identity does not contain the raw IP', ids.every((e) => !e.includes('203.0.113')));

  // ── Failure refunds the reservation; validation never costs a run ─────────
  const G2 = { ip: '203.0.113.20' };
  const rows0 = rowsFor('keyword_extract');
  r = await call('/api/tools/extract-keywords', { jobDescription: 'too short' }, G2);
  check('extractor: invalid input => 400 and no run reserved', r.status === 400 && rowsFor('keyword_extract') === rows0, `status=${r.status} rows ${rows0}->${rowsFor('keyword_extract')}`);
  const before = rowsFor('keyword_extract');
  mockMode = 'fail';
  r = await extract(G2);
  mockMode = 'ok';
  check('extractor: Claude failure => 500', r.status === 500, r.body);
  check('extractor: ...and the reserved run is refunded', rowsFor('keyword_extract') === before, `before=${before} after=${rowsFor('keyword_extract')}`);
  r = await extract(G2);
  check('extractor: after a refund the visitor still has their full allowance', r.status === 200 && r.json.usage.used === 1, r.body);

  // ── Concurrency: reservation closes the check-then-spend race ─────────────
  const G3 = { ip: '203.0.113.30' };
  mockDelayMs = 150;
  const burst = await Promise.all(Array.from({ length: 15 }, () => extract(G3)));
  mockDelayMs = 0;
  const wins = burst.filter((x) => x.status === 200).length, caps = burst.filter((x) => x.status === 402).length;
  check('extractor: 15 simultaneous guest requests => exactly 10 run, 5 refused', wins === 10 && caps === 5, `200s=${wins} 402s=${caps}`);

  // ── Free member: higher cap, separate bucket, guest:false ──────────────────
  const M = { token: 'tokFree', ip: '203.0.113.10' }; // same IP as the exhausted guest
  let mOk = 0;
  for (let i = 0; i < 30; i++) { r = await extract(M); if (r.status === 200) mOk++; }
  check('extractor: signed-in free member gets 30 runs (guest on the same IP is capped at 10)', mOk === 30, `ok=${mOk}`);
  check('extractor: member usage reports limit 30, guest:false', r.json.usage && r.json.usage.limit === 30 && r.json.usage.guest === false, r.body);
  r = await extract(M);
  check('extractor: member 31st run => 402 with guest:false (Pro upsell path)', r.status === 402 && r.json.guest === false && r.json.limit === 30 && /Pro/.test(r.json.message), r.body);

  // ── Pro: unlimited, nothing recorded ───────────────────────────────────────
  let pOk = 0; for (let i = 0; i < 12; i++) { r = await extract({ token: 'tokPro' }); if (r.status === 200) pOk++; }
  check('extractor: Pro is never capped', pOk === 12);
  check('extractor: Pro runs write no usage rows', db.prepare("SELECT COUNT(*) c FROM tool_usage WHERE user_email='pro@x.com'").get().c === 0);

  // ── Decoder: guest 3/day, member 10/day ────────────────────────────────────
  const D1 = { ip: '198.51.100.40' };
  let dOk = 0; for (let i = 0; i < 3; i++) { r = await decode(D1); if (r.status === 200) dOk++; }
  check('decoder: guest gets 3 runs', dOk === 3, `ok=${dOk}`);
  check('decoder: usage reports limit 3, guest:true', r.json.usage && r.json.usage.limit === 3 && r.json.usage.guest === true && r.json.usage.used === 3, r.body);
  r = await decode(D1);
  check('decoder: 4th guest run => 402 guest:true limit 3', r.status === 402 && r.json.guest === true && r.json.limit === 3, r.body);
  const DM = { token: 'tokFree', ip: '198.51.100.40' };
  dOk = 0; for (let i = 0; i < 10; i++) { r = await decode(DM); if (r.status === 200) dOk++; }
  check('decoder: signed-in free member gets 10 runs', dOk === 10, `ok=${dOk}`);
  r = await decode(DM);
  check('decoder: member 11th run => 402 guest:false limit 10', r.status === 402 && r.json.guest === false && r.json.limit === 10, r.body);
  // Decoder reserves its run before the Claude call (same pattern as the extractor).
  const D2 = { ip: '198.51.100.41' };
  const dRows0 = rowsFor('job_decode');
  mockMode = 'fail';
  r = await decode(D2);
  mockMode = 'ok';
  check('decoder: Claude failure => 502', r.status === 502, r.body);
  check('decoder: ...and the reserved run is refunded', rowsFor('job_decode') === dRows0, `before=${dRows0} after=${rowsFor('job_decode')}`);
  r = await decode(D2);
  check('decoder: after a refund the visitor still has their full allowance', r.status === 200 && r.json.usage.used === 1, r.body);
  const D3 = { ip: '198.51.100.42' };
  mockDelayMs = 150;
  const dBurst = await Promise.all(Array.from({ length: 8 }, () => decode(D3)));
  mockDelayMs = 0;
  const dWins = dBurst.filter((x) => x.status === 200).length, dCaps = dBurst.filter((x) => x.status === 402).length;
  check('decoder: 8 simultaneous guest requests => exactly 3 run, 5 refused', dWins === 3 && dCaps === 5, `200s=${dWins} 402s=${dCaps}`);
  const dRows1 = rowsFor('job_decode');
  r = await call('/api/tools/job-description-decode', { jobText: 'short' }, { ip: '198.51.100.43' });
  check('decoder: invalid input => 400 and no run reserved', r.status === 400 && rowsFor('job_decode') === dRows1, `status=${r.status} rows ${dRows1}->${rowsFor('job_decode')}`);
  r = await decode({ token: 'tokPro', ip: '198.51.100.40' });
  check('decoder: Pro is not capped', r.status === 200 && r.json.usage.pro === true, r.body);

  server.close();
}
