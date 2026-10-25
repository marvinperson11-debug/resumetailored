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
check('tool-hub upgrades route to the pricing page and never start checkout on the site', /resumetailored\.com\/pricing/.test(hub) && !/RTCheckout/.test(hub));

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
check('Cover Letter CTA opens the standalone app', /href="https:\/\/app\.resumetailored\.com"[^>]*>Generate Cover Letter Free/.test(read('public/ai-cover-letter-generator.html')));

// Server free utilities use an anonymous IP-scoped identity instead of auth.
for (const endpoint of ['job-description-decode', 'follow-up-generate', 'mock-interview']) {
  const route = new RegExp(`app\\.post\\('\\/api\\/tools\\/${endpoint}'[\\s\\S]{0,300}toolGate\\(req, res`);
  check(`${endpoint} uses the public tool gate`, route.test(server));
}
check('anonymous tool identity is privacy-preserving and quota-capable', /createHmac\('sha256', TOOLS_HASH_SALT\)[\s\S]{0,200}guest-\$\{h\}@anonymous\.local/.test(server));
check('anonymous tool identity is salted with a secret the server requires at boot', /TOOLS_HASH_SALT\.length < 16\) \{\s*throw new Error\('TOOLS_HASH_SALT must be set/.test(server));
check('ATS generation accepts anonymous requests', !/ats-scan'[\s\S]{0,500}if \(!email\) return res\.status\(401\)/.test(server));
check('LinkedIn generation accepts anonymous requests', !/optimize-linkedin'[\s\S]{0,500}if \(!email\) return res\.status\(401\)/.test(server));
check('ATS Keyword Extractor accepts anonymous requests', !/extract-keywords'[\s\S]{0,500}getSessionEmail\(req\)/.test(server));
check('Salary Script uses the anonymous public tool gate', /salary-negotiation'[\s\S]{0,300}toolGate\(req, res, null\)/.test(server));
check('Weekly Report does not redirect on page load', !/if\(thRequireLogin\(\)\) load\(\)/.test(read('public/tools/weekly-report.html')));
check('Tailor API accepts anonymous generation', !/api\/tailor'[\s\S]{0,1800}if \(!email\)[\s\S]{0,120}login_required/.test(server));
check('Interview Coach practice uses the anonymous public tool gate', /interview-coach\/question'[\s\S]{0,260}toolGate\(req, res/.test(server) && !/icStart[^\n]{0,180}location\.href='\/login'/.test(read('public/interview-coach.html')));
// The Job Seeker Decoder API stays Pro-gated (login + Pro required), so it is
// never an anonymous free tool. Its marketing landing is now branded
// "Complimentary" (a positioning change) and its CTA opens the standalone app.
check('Job Seeker Decoder API stays Pro-gated behind its complimentary-branded landing', /app\.post\('\/api\/decoder-key'[\s\S]{0,300}login_required[\s\S]{0,300}pro_required/.test(server) && /Job Seeker Decoder Key · Complimentary/.test(read('public/tool-landing.html')));
check('Employer Decoder has a separate employer-only API and portal workspace', /app\.post\('\/api\/employer\/decoder'/.test(server) && /data-view="decoder"/.test(read('public/employer.html')) && /employerOnly: true/.test(server));
check('named tools route through explanation pages before their workspaces', /linkedin-optimizer'[\s\S]{0,100}decoder-key'[\s\S]{0,100}interview-coach'[\s\S]{0,100}career-hub'/.test(server) && /\/tools\/decoder-key/.test(server) && /\/tools\/interview-coach/.test(server));

// Follow-up to the anonymous-tools work: honest cap prompt, pricing link, decoder reservation, one decoder-limit wording.
const cap = read('public/tool-cap-prompt.js');
check('guest cap prompt promises only what is true (resets tomorrow, go Pro)', /You've used today's free runs — they reset tomorrow\./.test(cap) && /Go Pro for unlimited runs\./.test(cap) && /See Pro plans/.test(cap));
check('guest cap prompt no longer offers a free account', !/Create a free account/i.test(cap) && !/app\.resumetailored\.com/.test(cap));
check('cap prompt Pro button goes to the pricing page', /var PRICING = 'https:\/\/resumetailored\.com\/pricing'/.test(cap) && /go\.href = PRICING/.test(cap));
check('tools-hub Pro button goes to the pricing page, not the app checkout', /location\.href = 'https:\/\/resumetailored\.com\/pricing'/.test(hub) && !/app\.resumetailored\.com\?upgrade=pro/.test(hub));
check('server guest 402 message does not promise an account', !/Create a free account to continue/.test(server) && /they reset tomorrow\. Go Pro for unlimited runs\./.test(server));
{
  const dec = server.slice(server.indexOf("app.post('/api/tools/job-description-decode'"), server.indexOf('const CORPORATE_OPERATIONAL_MODULES'));
  const rec = dec.indexOf('toolUsageRecord('), call = dec.indexOf('callClaudeJSON(');
  check('decoder reserves its run before the Claude call', rec > -1 && call > -1 && rec < call);
  check('decoder refunds the reservation when the call fails', /toolUsageRefund\(reservation\)/.test(dec) && /finally/.test(dec));
}
{
  const NEW = '3 free decodes a day — no account needed';
  const home = read('public/index.html'), faq = read('public/faq.html'), pricing = read('public/pricing.html');
  // Homepage count is 3, not 2: the free-plan answer lives in three copies that
  // must all match (JSON-LD, visible FAQ, and the i18n dict, which the language
  // toggle renders back into the page). The FAQ page has no i18n dict, so its
  // count stays 2 (JSON-LD + visible).
  check('homepage pricing list, FAQ and decoder promo card use the same decoder-limit wording', home.includes('Job Decoder · ' + NEW + '</li>') && (home.match(new RegExp('Job Decoder \\(' + NEW + '\\)', 'g')) || []).length === 3 && home.includes('<span class="promo-sub">· ' + NEW + '</span>'));
  check('FAQ page and pricing page use the same wording', (faq.match(new RegExp('Job Decoder \\(' + NEW + '\\)', 'g')) || []).length === 2 && pricing.includes('<strong>' + NEW + '</strong>'));
  check('no page still says the decoder is "3 per day"', ![home, faq, pricing].some((t) => /Job Decoder[^<]{0,12}3 per day|3 a day/.test(t)));
  check('Chinese pricing-list swap matches the new English string', home.includes("Job Decoder · " + NEW + "', '<span class=\"check-icon\">✓</span> 职位解码"));
}

if (failures) {
  console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('\nALL PASS (0 failures)');
