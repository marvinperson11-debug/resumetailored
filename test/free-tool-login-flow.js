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

// Tailor/Cover Letter generate anonymously, then recommend account creation.
for (const tool of [['AI Resume Tailor', 'tailor'], ['Cover Letter', 'tailor']]) {
  check(`${tool[0]} does not gate Generate with login`, !app.includes(`requireFreeActionLogin(${tool[1]}`));
}
check('ATS Scanner never opens an auth gate', !app.includes('requireFreeActionLogin(runDashboardATS'));
check('LinkedIn Optimizer never opens an auth gate', !app.includes('requireFreeActionLogin(optimizeLinkedIn'));
check('post-creation recommendation explains that anonymous work is not saved', /Create an account to save your resumes and cover letters\. Without an account, your work will not be saved\./.test(app));
check('post-creation recommendation is explicitly skippable', /Skip for now/.test(app));
check('generated work is preserved through optional signup', /rt_pending_creation/.test(app) && /restoreAnonymousCreation/.test(app));

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
check('standalone public-tool compatibility gate always allows the action', /async function requireForAction\(\)[\s\S]{0,220}return true/.test(shared));

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
check('tool-hub upgrades route to direct checkout or pricing', /RTCheckout/.test(hub) && /pricing#ecosystem-pricing/.test(hub));

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

// Server free utilities use an anonymous IP-scoped identity instead of auth.
for (const endpoint of ['job-description-decode', 'follow-up-generate', 'mock-interview']) {
  const route = new RegExp(`app\\.post\\('\\/api\\/tools\\/${endpoint}'[\\s\\S]{0,300}toolGate\\(req, res`);
  check(`${endpoint} uses the public tool gate`, route.test(server));
}
check('anonymous tool identity is privacy-preserving and quota-capable', /guest-.*createHash\('sha256'\).*anonymous\.local/.test(server));
check('ATS generation accepts anonymous requests', !/ats-scan'[\s\S]{0,500}if \(!email\) return res\.status\(401\)/.test(server));
check('LinkedIn generation accepts anonymous requests', !/optimize-linkedin'[\s\S]{0,500}if \(!email\) return res\.status\(401\)/.test(server));
check('ATS Keyword Extractor accepts anonymous requests', !/extract-keywords'[\s\S]{0,500}getSessionEmail\(req\)/.test(server));
check('Salary Script uses the anonymous public tool gate', /salary-negotiation'[\s\S]{0,300}toolGate\(req, res, null\)/.test(server));
check('Weekly Report does not redirect on page load', !/if\(thRequireLogin\(\)\) load\(\)/.test(read('public/tools/weekly-report.html')));
check('Tailor API accepts anonymous generation', !/api\/tailor'[\s\S]{0,1800}if \(!email\)[\s\S]{0,120}login_required/.test(server));
check('Interview Coach practice uses the anonymous public tool gate', /interview-coach\/question'[\s\S]{0,260}toolGate\(req, res/.test(server) && !/icStart[^\n]{0,180}location\.href='\/login'/.test(read('public/interview-coach.html')));
check('named tools route through explanation pages before their workspaces', /linkedin-optimizer'[\s\S]{0,100}decoder-key'[\s\S]{0,100}interview-coach'[\s\S]{0,100}career-hub'/.test(server) && /\/tools\/decoder-key/.test(server) && /\/tools\/interview-coach/.test(server));

if (failures) {
  console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('\nALL PASS (0 failures)');
