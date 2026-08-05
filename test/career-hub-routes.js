#!/usr/bin/env node
/**
 * Career Hub — HTTP route integration.
 *
 * Boots the real Express app against a throwaway SQLite DB and drives the
 * Career Hub routes end to end. LLM (Anthropic) and JSearch (RapidAPI) are
 * never called: the generative routes are exercised through their persistent
 * content caches, which we pre-seed the same way a prior generation would
 * have — so the routing, auth, gating, scoring, badge minting, quota
 * accounting and dashboard composition are all real, with no network or
 * API budget.
 *
 * Usage: node test/career-hub-routes.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const CH = require('../career-hub.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-ch-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
const Database = require('better-sqlite3');

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
// A free user and a Pro user.
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('free@x.com', 'Freddy Free', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokFree', 'free@x.com');
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('pro@x.com', 'Prya Pro', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokPro', 'pro@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('pro@x.com', 'cPro');
db.prepare('INSERT INTO saved_resumes (email,title,content,created_at) VALUES (?,?,?,?)')
  .run('free@x.com', 'My Resume', 'Jane Nurse\nSUMMARY\nRN with 5 years ICU experience.\nSKILLS\nBLS, IV', Date.now());

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
    check('profession GET requires auth', (await req('GET', '/api/profession')).status === 401);
    check('dashboard requires auth', (await req('GET', '/api/career/dashboard')).status === 401);

    // ── Phase 0: profession ───────────────────────────────────────────────────
    check('POST profession rejects an unknown id', (await req('POST', '/api/profession', 'tokFree', { professionId: 'wizard' })).status === 400);
    const setP = await req('POST', '/api/profession', 'tokFree', { professionId: 'registered-nurse', seniority: 'senior' });
    check('POST profession saves + resolves', setP.status === 200 && setP.json.displayLabel === 'Senior Registered Nurse', setP.body);
    const getP = await req('GET', '/api/profession', 'tokFree');
    check('GET profession returns the saved one', getP.json.id === 'registered-nurse' && getP.json.seniority === 'senior');
    await req('POST', '/api/profession', 'tokPro', { professionId: 'registered-nurse', seniority: 'senior' });

    const prof = CH.resolveProfession('registered-nurse', 'senior');

    // ── Phase 1: Skills Lab (seed quiz_cache so no LLM call) ───────────────────
    const quizPayload = { title: 'RN — general', questions: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, difficulty: 'easy', prompt: 'Q' + i, options: ['a', 'b', 'c', 'd'], answerIndex: i % 4, explanation: 'ex' + i })) };
    const qKey = CH.quizCacheKey(prof.id, prof.seniority, '');
    db.prepare('INSERT OR REPLACE INTO quiz_cache (cache_key,profession_id,seniority,topic,payload,created_at) VALUES (?,?,?,?,?,?)')
      .run(qKey, prof.id, prof.seniority, '', JSON.stringify(quizPayload), Date.now());

    const q1 = await req('POST', '/api/skills-lab/quiz', 'tokPro', { topic: '' });
    check('quiz served from cache (no answers leaked)', q1.status === 200 && q1.json.quiz.questions[0].answerIndex === undefined, q1.body);
    check('quiz delivery carries per-question order', Array.isArray(q1.json.quiz.questions[0].order));

    // Perfect submission for the Pro user → 100%, Gold, badge minted.
    const orders = q1.json.quiz.questions.map(x => x.order);
    const answers = q1.json.quiz.questions.map(x => x.order.indexOf(quizPayload.questions.find(o => o.id === x.id).answerIndex));
    const sub = await req('POST', '/api/skills-lab/submit', 'tokPro', { quizKey: q1.json.quizKey, answers, orders });
    check('perfect quiz scores 100', sub.json.score === 100, sub.body);
    check('Pro earns a Gold badge', sub.json.band === 'gold' && sub.json.badge && sub.json.badge.band === 'gold');
    check('submit returns explanations', sub.json.results[0].explanation === 'ex0');

    const badgePage = await req('GET', sub.json.badge.url, null);
    check('public badge page renders', badgePage.status === 200 && /100%/.test(badgePage.body) && /Prya Pro/.test(badgePage.body));
    check('unknown badge 404s', (await req('GET', '/badge/nope', null)).status === 404);

    // Free user: same perfect score is capped at Silver.
    const q1f = await req('POST', '/api/skills-lab/quiz', 'tokFree', { topic: '' });
    const subF = await req('POST', '/api/skills-lab/submit', 'tokFree', { quizKey: q1f.json.quizKey, answers: q1f.json.quiz.questions.map(x => x.order.indexOf(quizPayload.questions.find(o => o.id === x.id).answerIndex)), orders: q1f.json.quiz.questions.map(x => x.order) });
    check('Free perfect score is capped at Silver', subF.json.band === 'silver' && subF.json.goldLocked === true, subF.body);

    // Free quiz quota: 1 quiz + 1 retake = 2/day; the 3rd is blocked.
    // (q1f above was the 1st.)
    await req('POST', '/api/skills-lab/quiz', 'tokFree', { topic: '' }); // 2nd
    const q3 = await req('POST', '/api/skills-lab/quiz', 'tokFree', { topic: '' }); // 3rd
    check('Free quiz quota (1 + 1 retake) blocks the 3rd/day', q3.status === 402, q3.body);

    const attempts = await req('GET', '/api/skills-lab/attempts', 'tokFree');
    check('attempts are recorded', attempts.json.attempts.length >= 1);

    // Language: a Chinese request is served from a separately-keyed zh cache.
    const quizZh = { title: '注册护士测试', questions: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, difficulty: 'easy', prompt: '题目' + i, options: ['甲', '乙', '丙', '丁'], answerIndex: 0, explanation: '因为' + i })) };
    db.prepare('INSERT OR REPLACE INTO quiz_cache (cache_key,profession_id,seniority,topic,payload,created_at) VALUES (?,?,?,?,?,?)')
      .run(CH.quizCacheKey(prof.id, prof.seniority, '', 'zh'), prof.id, prof.seniority, '', JSON.stringify(quizZh), Date.now());
    const qzh = await req('POST', '/api/skills-lab/quiz', 'tokPro', { topic: '', lang: 'zh' });
    check('quiz is served in the requested language', qzh.status === 200 && qzh.json.quiz.title === '注册护士测试' && /题目/.test(qzh.json.quiz.questions[0].prompt), qzh.body);
    const badgeZhPage = await req('GET', sub.json.badge.url + '?lang=zh', null);
    check('badge page renders in Chinese with ?lang=zh', badgeZhPage.status === 200 && /金牌/.test(badgeZhPage.body));
    // Profession POST persists the language for server-side emails.
    await req('POST', '/api/profession', 'tokPro', { professionId: 'registered-nurse', seniority: 'senior', lang: 'zh' });
    const langRow = db.prepare("SELECT lang FROM check_ins WHERE email = 'pro@x.com'").get();
    check('profession POST stores the UI language', langRow && langRow.lang === 'zh', JSON.stringify(langRow));
    // reset pro back to en so later dashboard assertions read English state
    await req('POST', '/api/profession', 'tokPro', { professionId: 'registered-nurse', seniority: 'senior', lang: 'en' });

    // ── Phase 2: Interview (seed cache) ───────────────────────────────────────
    const ivPayload = { questions: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, kind: 'behavioral', prompt: 'IQ' + i, framework: 'STAR', modelAnswer: 'ans', watchFor: 'x' })) };
    const ivKey = CH.interviewCacheKey(prof.id, prof.seniority, 'behavioral');
    db.prepare('INSERT OR REPLACE INTO interview_cache (cache_key,profession_id,seniority,kind,payload,created_at) VALUES (?,?,?,?,?,?)')
      .run(ivKey, prof.id, prof.seniority, 'behavioral', JSON.stringify(ivPayload), Date.now());
    const iv = await req('POST', '/api/interview/questions', 'tokFree', { kind: 'behavioral' });
    check('behavioral questions served (free)', iv.status === 200 && iv.json.questions.length === 8);
    check('each question carries a stable hash', typeof iv.json.questions[0].hash === 'string');
    check('technical questions are Pro-gated for free users', (await req('POST', '/api/interview/questions', 'tokFree', { kind: 'technical' })).status === 402);
    const prog = await req('POST', '/api/interview/progress', 'tokFree', { questionHash: iv.json.questions[0].hash, confidence: 4 });
    check('interview progress saves', prog.json.success === true);
    check('score-my-answer is Pro-only', (await req('POST', '/api/interview/score', 'tokFree', { question: 'q', answer: 'a' })).status === 402);
    // Pro daily cap on score-my-answer: pre-spend the day's quota, then it 402s
    // BEFORE any Sonnet call (so this test never hits the LLM).
    const askKey = `user:pro@x.com_answerscore_${new Date().toISOString().slice(0, 10)}`;
    db.prepare('INSERT OR REPLACE INTO usage_store (key, count) VALUES (?, ?)').run(askKey, CH.LIMITS.answerScore.pro);
    const capped = await req('POST', '/api/interview/score', 'tokPro', { question: 'q', answer: 'a' });
    check('score-my-answer is capped 5/day for Pro', capped.status === 402 && capped.json.error === 'quota', capped.body);

    // Job alerts opt-in toggle.
    check('job alerts default off', (await req('GET', '/api/jobs/alerts', 'tokFree')).json.enabled === false);
    check('job alerts can be turned on', (await req('POST', '/api/jobs/alerts', 'tokFree', { enabled: true })).json.enabled === true);
    check('job alerts persist', (await req('GET', '/api/jobs/alerts', 'tokFree')).json.enabled === true);
    check('job alerts can be turned off', (await req('POST', '/api/jobs/alerts', 'tokFree', { enabled: false })).json.enabled === false);

    // ── Phase 3: Skills Gap (seed gap_cache) ──────────────────────────────────
    const resumeTxt = 'Jane Nurse\nSUMMARY\nRN with 5 years ICU experience.\nSKILLS\nBLS, IV';
    const jobTxt = 'Charge Nurse. Requires ACLS, EPIC EHR, leadership.';
    const gapPayload = { matchScore: 68, strengths: ['ICU experience'], gaps: [{ requirement: 'ACLS', severity: 'critical', evidence: 'not shown', action: 'get certified' }], quickWins: ['add BLS to top'], studyPlan: [{ skill: 'ACLS', how: 'course', estWeeks: 4 }] };
    db.prepare('INSERT OR REPLACE INTO gap_cache (cache_key,payload,created_at) VALUES (?,?,?)')
      .run(CH.gapCacheKey(resumeTxt, jobTxt), JSON.stringify(gapPayload), Date.now());
    const gap = await req('POST', '/api/skills-gap', 'tokFree', { resume: resumeTxt, jobText: jobTxt });
    check('gap analysis served from cache', gap.status === 200 && gap.json.matchScore === 68, gap.body);
    check('gap report is saved + listable', (await req('GET', '/api/skills-gap/reports', 'tokFree')).json.reports.length === 1);
    // Free weekly quota already consumed → second call blocked.
    const gap2 = await req('POST', '/api/skills-gap', 'tokFree', { resume: resumeTxt, jobText: jobTxt });
    check('free gap analysis is 1/week', gap2.status === 402, gap2.body);
    check('missing inputs → 400', (await req('POST', '/api/skills-gap', 'tokPro', { resume: 'x' })).status === 400);

    // ── Phase 4: Job Finder (save/list/delete + quota) ──
    // Search now fans out across multiple providers (see job-providers.js). With
    // NO keyed provider AND the zero-key fallbacks disabled, it reports
    // unconfigured. We disable fallbacks here so the test stays hermetic (no
    // live network call) and still exercises the unconfigured path.
    process.env.JOB_FALLBACKS_OFF = '1';
    const searchNoKey = await req('GET', '/api/jobs/search', 'tokPro');
    delete process.env.JOB_FALLBACKS_OFF;
    check('search reports unconfigured without any provider configured', searchNoKey.status === 503 && searchNoKey.json.error === 'jobs_unconfigured', searchNoKey.body);
    for (let i = 1; i <= 5; i++) await req('POST', '/api/jobs/save', 'tokFree', { job: { id: 'j' + i, title: 'RN ' + i, company: 'Co' } });
    const save6 = await req('POST', '/api/jobs/save', 'tokFree', { job: { id: 'j6', title: 'RN 6', company: 'Co' } });
    check('free save cap is 5 jobs', save6.status === 402, save6.body);
    const saved = await req('GET', '/api/jobs/saved', 'tokFree');
    check('saved jobs list returns 5', saved.json.jobs.length === 5);
    await req('DELETE', '/api/jobs/saved/' + saved.json.jobs[0].id, 'tokFree');
    check('a saved job can be deleted', (await req('GET', '/api/jobs/saved', 'tokFree')).json.jobs.length === 4);
    check('Pro is not capped at 5 saves', (await (async () => { for (let i = 1; i <= 7; i++) await req('POST', '/api/jobs/save', 'tokPro', { job: { id: 'p' + i, title: 'RN', company: 'Co' } }); return req('GET', '/api/jobs/saved', 'tokPro'); })()).json.jobs.length === 7);

    // ── Phase 6: Scenario Lab (seed cache) ────────────────────────────────────
    const scPayload = { title: 'Late order', situation: 'A customer says their order never arrived.', steps: [{ id: 1, prompt: 'First move?', options: [{ text: 'Check tracking', consequence: 'Good.' }, { text: 'Refund blindly', consequence: 'Costly.' }, { text: 'Ignore', consequence: 'Bad.' }], correctIndex: 0 }, { id: 2, prompt: 'Next?', options: [{ text: 'Contact carrier', consequence: 'Good.' }, { text: 'Blame customer', consequence: 'Bad.' }], correctIndex: 0 }, { id: 3, prompt: 'Close it?', options: [{ text: 'Follow up', consequence: 'Good.' }, { text: 'Drop it', consequence: 'Bad.' }], correctIndex: 0 }], outcome: 'Resolved with a follow-up.' };
    db.prepare('INSERT OR REPLACE INTO scenario_cache (cache_key,profession_id,scenario_type,payload,created_at) VALUES (?,?,?,?,?)')
      .run(CH.scenarioCacheKey(prof.id, 'customer-service'), prof.id, 'customer-service', JSON.stringify(scPayload), Date.now());
    const sc = await req('POST', '/api/scenario-lab/scenario', 'tokPro', { scenarioType: 'customer-service' });
    check('scenario served from cache', sc.status === 200 && sc.json.scenario.steps.length === 3, sc.body);
    check('scenario complete records progress', (await req('POST', '/api/scenario-lab/complete', 'tokPro', { scenarioType: 'customer-service', perfect: true })).json.success === true);
    // Free weekly scenario quota.
    db.prepare('INSERT OR REPLACE INTO scenario_cache (cache_key,profession_id,scenario_type,payload,created_at) VALUES (?,?,?,?,?)')
      .run(CH.scenarioCacheKey(prof.id, 'customer-service'), prof.id, 'customer-service', JSON.stringify(scPayload), Date.now());
    const scF1 = await req('POST', '/api/scenario-lab/scenario', 'tokFree', { scenarioType: 'customer-service' });
    const scF2 = await req('POST', '/api/scenario-lab/scenario', 'tokFree', { scenarioType: 'customer-service' });
    check('free scenario is 1/week', scF1.status === 200 && scF2.status === 402, scF1.status + '/' + scF2.status);

    // ── Phase 5: Dashboard + coach ────────────────────────────────────────────
    const dash = await req('GET', '/api/career/dashboard', 'tokPro');
    check('dashboard composes the full shape', dash.status === 200 && dash.json.profession && dash.json.skills && dash.json.nextSteps, dash.body);
    check('dashboard counts saved jobs', dash.json.jobs.saved === 7);
    check('dashboard reflects scenario completion', dash.json.scenarios.done >= 1);
    check('coach summary is Pro-gated', (await req('GET', '/api/career/coach', 'tokFree')).status === 402);
  } catch (e) {
    console.error('THREW', e && e.stack ? e.stack : e); failures++;
  } finally {
    server.close();
    if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
    console.log('\nALL PASS (0 failures)');
    process.exit(0);
  }
});
