#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
let failures = 0;
function check(name, ok) {
  if (ok) console.log('PASS', name);
  else { failures++; console.error('FAIL', name); }
}

const app = read('public/app.html');
const server = read('server.js');
const shared = read('public/free-tool-auth.js');
const hub = read('public/tools-hub.js');
const tracker = read('public/job-tracker.js');

// Dashboard tools: one server-authoritative helper, pending callback preserved,
// and no raw client flag deciding whether a login modal appears.
for (const tool of [
  ['AI Resume Tailor', 'tailor'], ['Cover Letter', 'tailor'],
  ['ATS Scanner', 'runDashboardATS'], ['LinkedIn Optimizer', 'optimizeLinkedIn'],
  ['Share Link', 'shareResumeLink']
]) {
  check(`${tool[0]} uses login-at-Generate`, app.includes(`requireFreeActionLogin(${tool[1]}`));
}
check('dashboard waits for the authoritative auth request', /await authReadyPromise/.test(app));
check('dashboard preserves the pending callback through the modal', /showAuthModal\('login', true\)/.test(app));
check('dashboard replays output after login', /setTimeout\(fn, 300\)/.test(app));

// Standalone local/API tools use the shared gate only inside their action.
const standalone = [
  ['ATS Scanner landing', 'public/ats-score-checker.html', 'runCheck'],
  ['Resume Analyzer / Readability Review', 'public/resume-analyzer.html', 'runAnalysis'],
  ['Keyword Extractor', 'public/tools/ats-keyword-extractor.html', 'extractKeywords']
];
for (const [name, file, action] of standalone) {
  const src = read(file);
  check(`${name} loads the shared action gate`, /free-tool-auth\.js/.test(src));
  check(`${name} gates only its action`, src.includes(`requireForAction('${action}')`));
}
check('standalone forms are saved for post-login continuation', /sessionStorage\.setItem\(KEY/.test(shared));
check('standalone actions resume after verified login', /typeof window\[pending\.action\] === 'function'/.test(shared));
check('cookie sessions are checked through /api/auth/me', /fetch\('\/api\/auth\/me'/.test(shared));

// Shared /tools pages all wait for a 401 from the action endpoint; browsing and
// client-side validation happen before that point.
const hubTools = [
  ['Offer Calculator', 'public/tools/offer-comparison.html', 'compare'],
  ['Job Decoder', 'public/tools/job-description-decoder.html', 'decode'],
  ['Follow-Up Email', 'public/tools/follow-up-generator.html', 'gen'],
  ['Mock Interview', 'public/tools/mock-interview.html', 'start'],
  ['Salary Script', 'public/tools/salary-negotiation.html', 'gen'],
  ['A/B Test Tracker', 'public/tools/resume-ab-tracker.html', 'saveVersion']
];
for (const [name, file, action] of hubTools) {
  const src = read(file);
  check(`${name} stores and resumes its Generate action`, src.includes(`thHandleGate(res,'${action}')`));
}
const ab = read('public/tools/resume-ab-tracker.html');
check('A/B Test Tracker no longer redirects on page load', !/if\s*\(thRequireLogin\(\)\)\s*load\(\)/.test(ab));
check('A/B Test Tracker renders a public empty workspace on 401', /res\.status===401\)\{ render\(\[\]\); return; \}/.test(ab));
check('tool-hub pending state restores dynamic Offer fields', /offerCount/.test(hub) && /while \(document\.querySelectorAll\('\[data-offer\]'\)/.test(hub));
check('tool-hub checks cookie sessions before Pro checkout', /thStartPro = async/.test(hub) && /thApi\('GET', '\/api\/auth\/me'\)/.test(hub));

// Job Tracker is browsable anonymously; only Add Application links to login.
check('Job Tracker always asks the API instead of trusting local markers', !/if \(!token\(\) && !localStorage\.getItem\('rt_email'\)\)/.test(tracker));
check('Job Tracker anonymous view is not a login wall', !/<h3>Log in to track/.test(tracker));
check('Job Tracker requests login only from Add Application', /\+ Add Application<\/a>/.test(tracker) && /login\?redirect=/.test(tracker));

// Browse-only libraries and marketing landings must not contain an automatic
// auth redirect. Their CTA opens the usable tool, where the Generate gate lives.
for (const [name, file] of [
  ['Resume Examples', 'public/resume-examples.html'],
  ['Cover Letter Examples', 'public/cover-letter-examples.html'],
  ['AI Resume Tailor landing', 'public/ai-resume-tailor.html'],
  ['Cover Letter landing', 'public/ai-cover-letter-generator.html']
]) {
  const src = read(file);
  check(`${name} has no automatic login redirect`, !/location\.(?:href|assign)\s*\(?\s*['"]\/login/.test(src));
}
check('Cover Letter CTA opens Cover Letter mode', /href="\/cover-letter"[^>]*>Generate Cover Letter Free/.test(read('public/ai-cover-letter-generator.html')));

// Server enforcement ensures anonymous callers cannot bypass the UI, while
// authenticated free sessions reach validation/output without a Pro gate.
for (const endpoint of ['job-description-decode', 'follow-up-generate', 'mock-interview']) {
  const route = new RegExp(`app\\.post\\('\\/api\\/tools\\/${endpoint}'[\\s\\S]{0,300}toolGate\\(req, res`);
  check(`${endpoint} is server login-gated`, route.test(server));
}
check('Offer comparison is server login-gated', /offer-comparison'[\s\S]{0,180}toolGate\(req, res, null\)/.test(server));
check('Salary generation is server login-gated', /salary-negotiation'[\s\S]{0,260}if \(!email\) return res\.status\(401\)/.test(server));
check('Keyword extraction is server login-gated', /extract-keywords'[\s\S]{0,900}if \(!getSessionEmail\(req\)\)/.test(server));
check('ATS generation is server login-gated', /ats-scan'[\s\S]{0,500}if \(!email\) return res\.status\(401\)/.test(server));
check('LinkedIn generation is server login-gated', /optimize-linkedin'[\s\S]{0,500}if \(!email\) return res\.status\(401\)/.test(server));
check('Share Link generation is server login-gated', /api\/share'[\s\S]{0,300}if \(!ownerEmail\) return res\.status\(401\)/.test(server));

if (failures) {
  console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('\nALL PASS (0 failures)');
