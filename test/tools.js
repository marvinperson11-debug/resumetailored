#!/usr/bin/env node
/**
 * The 7 job-search tools — pure core + HTTP route integration.
 *
 * Part 1 unit-tests tools-core.js (offer scoring, validators, version summary,
 * weekly-report email, weekly cron timing) with no I/O.
 *
 * Part 2 boots the real Express app against a throwaway SQLite DB and drives
 * every /api/tools/* route end to end. The generative routes (JD decode,
 * follow-up, mock interview, salary) are NOT called against Anthropic — the
 * test only exercises their auth + quota gating (the 401/402/400 paths that
 * run BEFORE any LLM call), so no API budget or network is used. Offer
 * comparison, the A/B tracker CRUD + cap, and the weekly-report toggle are
 * fully real.
 *
 * Usage: node test/tools.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const TOOLS = require('../tools-core.js');
const CRON = require('../career-cron.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// ══ Part 1: pure core ═══════════════════════════════════════════════════════
(function pureCore() {
  // Offer scoring — higher total comp + remote + short commute wins.
  const r = TOOLS.scoreOffers([
    { label: 'A', baseSalary: 120000, bonus: 10000, equityPerYear: 20000, benefitsValue: 8000, commuteMinutes: 45, ptoDays: 15, remote: false },
    { label: 'B', baseSalary: 118000, bonus: 8000, equityPerYear: 18000, benefitsValue: 8000, commuteMinutes: 0, ptoDays: 25, remote: true },
  ]);
  check('offer: two rows scored', r.rows.length === 2);
  check('offer: every score is 0..100', r.rows.every(x => x.score >= 0 && x.score <= 100));
  check('offer: totalComp computed', r.rows[0].totalComp === 158000, String(r.rows[0].totalComp));
  check('offer: B (remote, no commute, more PTO) wins despite lower comp', r.bestLabel === 'B', r.bestLabel);
  let threw = false; try { TOOLS.scoreOffers([{ label: 'solo' }]); } catch (e) { threw = e.code === 'need_two_offers'; }
  check('offer: <2 offers throws need_two_offers', threw);
  // Identical offers score equally and finitely (no NaN from a zero denominator).
  const eq = TOOLS.scoreOffers([{ label: 'X', baseSalary: 100000 }, { label: 'Y', baseSalary: 100000 }]);
  check('offer: identical offers score equal + finite (no NaN)', eq.rows[0].score === eq.rows[1].score && Number.isFinite(eq.rows[0].score), JSON.stringify(eq.rows.map(x => x.score)));

  // Validators — accept a good shape, reject a bad one.
  check('validateJobDecode ok', TOOLS.validateJobDecode({ summary: 'A real role', seniority: 'mid', redFlags: ['a'], greenFlags: [], hiddenRequirements: [], salaryRange: { low: 90000, high: 110000, note: 'est' } }).ok);
  check('validateJobDecode rejects empty summary', !TOOLS.validateJobDecode({ summary: '' }).ok);
  check('validateMockQuestions needs >=3', !TOOLS.validateMockQuestions({ questions: [{ id: 1, question: 'q' }] }).ok);
  const mf = TOOLS.validateMockFeedback({ items: [{ id: 1, score: 200, strengths: 's', improvements: 'i' }] });
  check('validateMockFeedback clamps score to 100', mf.ok && mf.value.items[0].score === 100, JSON.stringify(mf.value));
  check('validateMockFeedback derives overall when missing', mf.value.overallScore === 100);
  check('validateSalary needs a script', !TOOLS.validateSalary({ marketRange: {}, counterOffer: {} }).ok);
  check('validateSalary ok (free shape: no market/templates)', TOOLS.validateSalary({ counterOffer: { base: 3, note: 'n' }, talkingPoints: ['a'], script: 'do it' }).ok);
  // Pro shape: email templates are validated + carried when present.
  const salPro = TOOLS.validateSalary({ counterOffer: { base: 3 }, talkingPoints: ['a'], script: 'do it', marketRange: { low: 1, high: 2, note: 'n' }, emailTemplates: { initialCounter: 'hi', followUp: 'still there?', finalPush: 'final' } });
  check('validateSalary carries emailTemplates when present', salPro.ok && salPro.value.emailTemplates.followUp === 'still there?', JSON.stringify(salPro.value.emailTemplates || null));
  check('validateSalary omits emailTemplates when absent (free)', !('emailTemplates' in TOOLS.validateSalary({ counterOffer: {}, talkingPoints: [], script: 'x' }).value));

  // Risk meter — deterministic, versus the market median.
  check('computeRiskMeter: 15% above median => moderate', (() => { const r = TOOLS.computeRiskMeter(115, 90, 110); return r && r.percent === 15 && r.level === 'moderate'; })());
  check('computeRiskMeter: at/below median => low', (() => { const r = TOOLS.computeRiskMeter(100, 90, 110); return r && r.level === 'low'; })());
  check('computeRiskMeter: 30% above => high', (() => { const r = TOOLS.computeRiskMeter(130, 90, 110); return r && r.level === 'high'; })());
  check('computeRiskMeter: null without a band', TOOLS.computeRiskMeter(150, null, null) === null);

  // AI diagnosis validator.
  const diag = TOOLS.validateDiagnosis({ matchScore: 250, missingKeywords: ['Kubernetes', ''], presentKeywords: ['SQL'], suggestions: ['Add a metrics bullet'] });
  check('validateDiagnosis clamps score + cleans arrays', diag.ok && diag.value.matchScore === 100 && diag.value.missingKeywords.length === 1, JSON.stringify(diag.value));

  // Prompt builders don't throw and echo the language.
  check('buildJobDecodePrompt returns system+user', !!TOOLS.buildJobDecodePrompt('x'.repeat(50), 'en').user);
  check('buildFollowUpPrompt clamps daysSince to >=1', TOOLS.buildFollowUpPrompt({ company: 'A', role: 'B', daysSince: -3 }, 'en').user.includes('Days since applying: 1'));
  check('buildSalaryPrompt (pro) notes estimate when no market hint', TOOLS.buildSalaryPrompt({ role: 'PM' }, null, 'en', true).user.includes('estimate'));
  check('buildSalaryPrompt (pro) injects a live market hint when given', TOOLS.buildSalaryPrompt({ role: 'PM' }, 'listings say $150k', 'en', true).user.includes('listings say $150k'));
  check('buildSalaryPrompt (pro) asks for email templates', TOOLS.buildSalaryPrompt({ role: 'PM' }, null, 'en', true).user.includes('emailTemplates'));
  check('buildSalaryPrompt (free) omits market data + templates', (() => { const u = TOOLS.buildSalaryPrompt({ role: 'PM' }, null, 'en', false).user; return !u.includes('emailTemplates') && !u.includes('marketRange'); })());
  check('buildDiagnosisPrompt returns system+user', !!TOOLS.buildDiagnosisPrompt('resume', 'jd', 'en').user);

  // Version summary — leader is best response rate with >=1 application.
  const vs = TOOLS.summarizeVersions([
    { id: 1, version_name: 'v1', job_tag: 'Stripe — PM', jobs_applied_with: 10, responses_received: 2 }, // 20%
    { id: 2, version_name: 'v2', jobs_applied_with: 8, responses_received: 4 },  // 50%
    { id: 3, version_name: 'v3', jobs_applied_with: 0, responses_received: 0 },  // no signal
  ]);
  check('summarizeVersions computes response rate', vs.versions[0].responseRate === 20 && vs.versions[2].responseRate === null);
  check('summarizeVersions carries the job_tag', vs.versions[0].job_tag === 'Stripe — PM', vs.versions[0].job_tag);
  check('summarizeVersions picks the leader', vs.leaderId === 2, String(vs.leaderId));
  // stripAnalytics (free) removes the computed rate + leader, keeps raw counts.
  const stripped = TOOLS.stripAnalytics(vs);
  check('stripAnalytics nulls responseRate + leaderId, keeps counts', stripped.leaderId === null && stripped.versions[0].responseRate === null && stripped.versions[0].jobs_applied_with === 10);

  // Weekly report email builder.
  const wr = TOOLS.buildWeeklyReportEmail({ name: 'Sam', stats: { applied: 7, responses: 2, interviews: 1, staleFollowUps: [{ company: 'Acme', role: 'Dev', days: 9 }] } });
  check('weekly email subject reflects counts', /7 applied, 2 responses/.test(wr.subject), wr.subject);
  check('weekly email lists the follow-up', wr.html.includes('Acme'));
  check('weekly email suggests follow-up action', wr.html.toLowerCase().includes('follow-up'));

  // Weekly cron timing lands on a Monday (UTC day 1) in the future.
  const from = new Date(Date.UTC(2026, 7, 8, 12, 0, 0)); // a Saturday
  const ms = CRON.msUntilWeekly(1, 13, 0, from);
  const fire = new Date(from.getTime() + ms);
  check('scheduleWeekly next fire is a future Monday 13:00 UTC', fire.getUTCDay() === 1 && fire.getUTCHours() === 13 && ms > 0, fire.toUTCString());
})();

// ══ Part 2: HTTP routes ═════════════════════════════════════════════════════
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-tools-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
const Database = require('better-sqlite3');
const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('free@x.com', 'Freddy', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokFree', 'free@x.com');
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('pro@x.com', 'Prya', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokPro', 'pro@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('pro@x.com', 'cPro');

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
    // ── Offer Comparison: free + anonymous ──────────────────────────────────
    let r = await req('POST', '/api/tools/offer-comparison', null, { offers: [{ label: 'A', baseSalary: 100000 }, { label: 'B', baseSalary: 130000, remote: true }] });
    check('offer route: anonymous 200 + winner', r.status === 200 && r.json.bestLabel === 'B', r.body);
    r = await req('POST', '/api/tools/offer-comparison', null, { offers: [{ label: 'A' }] });
    check('offer route: <2 offers => 400', r.status === 400);

    // ── Gated generative tools: auth + validation gates (no LLM call) ───────
    check('jd decode: no auth => 401', (await req('POST', '/api/tools/job-description-decode', null, { jobText: 'x'.repeat(60) })).status === 401);
    check('jd decode: too short => 400', (await req('POST', '/api/tools/job-description-decode', 'tokFree', { jobText: 'short' })).status === 400);
    check('follow-up: missing fields => 400', (await req('POST', '/api/tools/follow-up-generate', 'tokFree', { company: '' })).status === 400);
    check('mock interview: missing role => 400', (await req('POST', '/api/tools/mock-interview', 'tokFree', { action: 'questions', role: '' })).status === 400);
    check('mock feedback: no answers => 400', (await req('POST', '/api/tools/mock-interview', 'tokFree', { action: 'feedback', answers: [] })).status === 400);
    // Salary is FREE + unlimited + no account required — so no 401. Only the
    // missing-role validation (which runs before any LLM call) is exercised
    // here, for both an anonymous and a signed-in caller.
    check('salary: anonymous is allowed (missing role => 400, not 401)', (await req('POST', '/api/tools/salary-negotiation', null, { role: '' })).status === 400);
    check('salary: signed-in missing role => 400', (await req('POST', '/api/tools/salary-negotiation', 'tokFree', { role: '' })).status === 400);

    // ── Quota gate: pre-seed tool_usage rows to hit the day/month cap ────────
    for (let i = 0; i < TOOLS.LIMITS.jobDecode.free; i++) db.prepare('INSERT INTO tool_usage (user_email,tool_name) VALUES (?,?)').run('free@x.com', TOOLS.LIMITS.jobDecode.tool);
    r = await req('POST', '/api/tools/job-description-decode', 'tokFree', { jobText: 'x'.repeat(60) });
    check('jd decode: over daily cap => 402', r.status === 402 && r.json.error === 'quota', r.body);
    for (let i = 0; i < TOOLS.LIMITS.followUp.free; i++) db.prepare('INSERT INTO tool_usage (user_email,tool_name) VALUES (?,?)').run('free@x.com', TOOLS.LIMITS.followUp.tool);
    r = await req('POST', '/api/tools/follow-up-generate', 'tokFree', { company: 'A', role: 'B' });
    check('follow-up: over monthly cap => 402', r.status === 402);
    // Pro is never capped, even with usage rows present.
    for (let i = 0; i < 10; i++) db.prepare('INSERT INTO tool_usage (user_email,tool_name) VALUES (?,?)').run('pro@x.com', TOOLS.LIMITS.jobDecode.tool);
    check('jd decode: Pro passes the gate (400 for short input, not 402)', (await req('POST', '/api/tools/job-description-decode', 'tokPro', { jobText: 'short' })).status === 400);

    // ── Resume A/B Tracker: CRUD + free 3-version cap + analytics gating ─────
    r = await req('GET', '/api/tools/resume-versions', 'tokFree');
    check('versions: list starts empty', r.status === 200 && r.json.versions.length === 0);
    check('versions: unauth 401', (await req('GET', '/api/tools/resume-versions')).status === 401);
    await req('POST', '/api/tools/resume-version', 'tokFree', { versionName: 'v1', jobTag: 'Stripe — PM', jobsAppliedWith: 10, responsesReceived: 2 });
    await req('POST', '/api/tools/resume-version', 'tokFree', { versionName: 'v2', jobsAppliedWith: 8, responsesReceived: 4 });
    await req('POST', '/api/tools/resume-version', 'tokFree', { versionName: 'v3', jobsAppliedWith: 5, responsesReceived: 1 });
    r = await req('POST', '/api/tools/resume-version', 'tokFree', { versionName: 'v4' });
    check('versions: 4th on free => 402 (free cap is 3)', r.status === 402);
    check('versions: name required => 400', (await req('POST', '/api/tools/resume-version', 'tokFree', { versionName: '' })).status === 400);
    check('versions: Pro can save beyond the free cap', (await req('POST', '/api/tools/resume-version', 'tokPro', { versionName: 'p1', resumeText: 'led a team', jobsAppliedWith: 10, responsesReceived: 2 })).status === 200);
    await req('POST', '/api/tools/resume-version', 'tokPro', { versionName: 'p2', jobsAppliedWith: 8, responsesReceived: 5 });

    // Free user: response-rate analytics + leader are stripped (Pro feature);
    // the raw counts and the job tag remain (the free basic side-by-side).
    r = await req('GET', '/api/tools/resume-versions', 'tokFree');
    check('versions: free response is analytics:false', r.json.analytics === false && r.json.pro === false, r.body);
    check('versions: free has no leader + no responseRate', r.json.leaderId === null && r.json.versions.every(v => v.responseRate === null), JSON.stringify(r.json.versions));
    check('versions: free keeps raw counts + job_tag', r.json.versions.some(v => v.job_tag === 'Stripe — PM' && v.jobs_applied_with === 10));
    check('versions: free cap surfaced as 3', r.json.limit === 3, String(r.json.limit));

    // Pro user: analytics on, leader is the higher response rate (p2 @ ~62%).
    r = await req('GET', '/api/tools/resume-versions', 'tokPro');
    check('versions: pro response is analytics:true', r.json.analytics === true && r.json.pro === true);
    check('versions: pro leader is the higher response rate (p2)', r.json.leaderId === r.json.versions.find(v => v.version_name === 'p2').id, JSON.stringify(r.json));

    // AI diagnosis is Pro-only; gates run before any LLM call.
    const proVid = r.json.versions.find(v => v.version_name === 'p1').id;
    check('diagnose: free => 402 pro_only', (await req('POST', '/api/tools/resume-version/' + proVid + '/diagnose', 'tokFree', { jobText: 'x'.repeat(60) })).status === 402);
    check('diagnose: pro unknown version => 404', (await req('POST', '/api/tools/resume-version/999999/diagnose', 'tokPro', { jobText: 'x'.repeat(60) })).status === 404);
    check('diagnose: pro too-short JD => 400', (await req('POST', '/api/tools/resume-version/' + proVid + '/diagnose', 'tokPro', { jobText: 'short' })).status === 400);

    r = await req('GET', '/api/tools/resume-versions', 'tokFree');
    const vid = r.json.versions[0].id;
    check('versions: patch stats 200', (await req('PATCH', '/api/tools/resume-version/' + vid, 'tokFree', { jobsAppliedWith: 20, responsesReceived: 9 })).status === 200);
    check('versions: patch someone else\'s id => 404', (await req('PATCH', '/api/tools/resume-version/999999', 'tokFree', {})).status === 404);
    check('versions: delete 200', (await req('DELETE', '/api/tools/resume-version/' + vid, 'tokFree')).status === 200);
    check('versions: delete again => 404', (await req('DELETE', '/api/tools/resume-version/' + vid, 'tokFree')).status === 404);

    // ── Weekly Report: Pro-only toggle ──────────────────────────────────────
    // Weekly Job Search Report is now a FREE tool — a signed-in free user can
    // switch it on (no Pro gate). Only sign-in is required.
    { const fr = await req('POST', '/api/tools/weekly-report/toggle', 'tokFree', { enabled: true });
      check('weekly: free toggle => 200 enabled', fr.status === 200 && fr.json.enabled === true, fr.body); }
    r = await req('POST', '/api/tools/weekly-report/toggle', 'tokPro', { enabled: true });
    check('weekly: pro toggle on => 200 enabled', r.status === 200 && r.json.enabled === true, r.body);
    r = await req('GET', '/api/tools/weekly-report', 'tokPro');
    check('weekly: pro GET reflects enabled', r.json.enabled === true && r.json.pro === true);
    r = await req('POST', '/api/tools/weekly-report/toggle', 'tokPro', { enabled: false });
    check('weekly: pro toggle off => 200 disabled', r.status === 200 && r.json.enabled === false);
    check('weekly: unauth GET 401', (await req('GET', '/api/tools/weekly-report')).status === 401);

    // ── Pages serve with versioned shared assets ────────────────────────────
    const page = await req('GET', '/tools/offer-comparison');
    check('tool page serves + versions /tools-hub.css', page.status === 200 && /href="\/tools-hub\.css\?v=/.test(page.body));
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
