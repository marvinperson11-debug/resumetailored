#!/usr/bin/env node
/**
 * AI Interview Coach — HTTP routes. Boots the real app against a throwaway DB.
 * Verifies: sign-in gate, the free teaser (1 text question/day then 402),
 * voice mode Pro-only, feedback (heuristic fallback with no AI key), and that
 * progress is saved for Pro but withheld from free. Usage: node test/...
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-ic-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
process.env.OPENAI_API_KEY = ''; process.env.ANTHROPIC_API_KEY = ''; // force heuristic feedback even when dotenv is present
const { app } = require('../server.js');
const Database = require('better-sqlite3');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('free@u.com', 'Free', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tFree', 'free@u.com');
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('pro@u.com', 'Pro', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tPro', 'pro@u.com');
db.prepare('INSERT INTO subscribers (email, customer_id) VALUES (?,?)').run('pro@u.com', 'cus_pro');

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
const answer = 'When our reporting was slow, I was responsible for fixing it. I rebuilt the pipeline and we reduced load time by 40%, improving adoption.';

let PORT;
const server = app.listen(0, async () => {
  PORT = server.address().port;
  try {
    check('question supports anonymous practice', (await req('POST', '/api/interview-coach/question', null, {})).status === 200);

    // Free teaser: one question, then locked for the day.
    const q1 = await req('POST', '/api/interview-coach/question', 'tFree', { role: 'Data Analyst' });
    check('free gets the teaser question (text mode only)', q1.status === 200 && q1.json.teaser === true && q1.json.modes.join() === 'text', q1.body);
    check('teaser marks voice/report/progress as locked', q1.json.locked.voice && q1.json.locked.report && q1.json.locked.progress);
    const q2 = await req('POST', '/api/interview-coach/question', 'tFree', { role: 'Data Analyst' });
    check('free second question same day → 402 quota', q2.status === 402 && q2.json.error === 'quota', q2.body);

    // Free gets basic feedback (heuristic).
    const fb = await req('POST', '/api/interview-coach/feedback', 'tFree', { role: 'Data Analyst', question: 'Tell me about impact', answer, mode: 'text' });
    check('free gets basic text feedback', fb.status === 200 && fb.json.feedback && typeof fb.json.feedback.overall === 'number', fb.body);
    check('free feedback is NOT saved to progress / no full report', fb.json.savedToProgress === false && fb.json.fullReport === false);
    check('free rejects an empty answer', (await req('POST', '/api/interview-coach/feedback', 'tFree', { answer: '', question: 'x' })).status === 400);
    check('free cannot use voice mode (402)', (await req('POST', '/api/interview-coach/feedback', 'tFree', { answer, mode: 'voice', question: 'x' })).status === 402);
    check('free is denied progress history (402)', (await req('GET', '/api/interview-coach/progress', 'tFree')).status === 402);

    // Pro: unlimited questions, voice mode + delivery, saved progress.
    for (let i = 0; i < 3; i++) { const r = await req('POST', '/api/interview-coach/question', 'tPro', { role: 'PM', askedIds: [] }); check('pro question ' + i + ' unlimited', r.status === 200 && r.json.pro === true && r.json.modes.length === 2); }
    const vfb = await req('POST', '/api/interview-coach/feedback', 'tPro', { role: 'PM', question: 'Tell me about a challenge', answer: 'Um, so like, I basically led it and, uh, we grew revenue by 15%.', mode: 'voice', durationSec: 12 });
    check('pro voice feedback returns a delivery analysis', vfb.status === 200 && vfb.json.delivery && vfb.json.delivery.fillerCount >= 3, vfb.body);
    check('pro feedback saved to progress + full report', vfb.json.savedToProgress === true && vfb.json.fullReport === true);
    const prog = await req('GET', '/api/interview-coach/progress', 'tPro');
    check('pro progress history returns saved sessions + avg', prog.status === 200 && prog.json.count >= 1 && typeof prog.json.avgOverall === 'number', prog.body);

    console.log(failures ? `\nFAILED (${failures} failure${failures === 1 ? '' : 's'})` : '\nALL PASS (0 failures)');
    server.close(() => process.exit(failures ? 1 : 0));
  } catch (e) { console.error('THREW', e); server.close(() => process.exit(1)); }
});
