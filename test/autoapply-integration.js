#!/usr/bin/env node
/**
 * Auto-Applyer wiring guard.
 *
 * The AutoApply tool ships as a marketing landing page (/tools/autoapply) plus a
 * separate Next.js app + browser extension under autoapply/. This test guards the
 * pieces that live in the main Express+static site: that AutoApply is discoverable
 * (homepage, nav, /score, llms.txt), that the Job Finder is wired into it (an
 * Auto-Apply button per job, a localStorage apply queue, a "My Apply Queue" panel,
 * a setup gate), and that every tool landing page cross-links to all the others via
 * the shared related-tools.js component.
 *
 * Pure static-source checks — no server boot. Usage: node test/autoapply-integration.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(__dirname, '..', rel));

// ── 1. The AutoApply landing page exists and is a real marketing page. ────────
check('AutoApply landing page exists', exists('public/tools/autoapply.html'));
const aa = read('public/tools/autoapply.html');
check('AutoApply page has a canonical /tools/autoapply', /canonical"\s+href="[^"]*\/tools\/autoapply"/.test(aa));
check('AutoApply page links out to the app', /href="\/dashboard"/.test(aa));

// ── 2. Discoverability: homepage, nav, free-tools hub, llms.txt. ──────────────
const index = read('public/index.html');
check('homepage advertises AutoApply (card CTA)', /href="\/tools\/autoapply"/.test(index));
check('homepage footer/menu lists AutoApply', (index.match(/\/tools\/autoapply/g) || []).length >= 2);
check('site-nav hamburger directory includes AutoApply', /\/tools\/autoapply/.test(read('public/site-nav.js')));
check('free-tools hub (/score) features AutoApply', /\/tools\/autoapply/.test(read('public/score.html')));
const llms = read('public/llms.txt');
check('llms.txt has an AutoApply entry', /autoapply/i.test(llms) && /tools\/autoapply/.test(llms));
check('llms.txt has a Job Finder entry', /Job Finder/i.test(llms));

// ── 3. Job Finder ↔ AutoApply integration (public/career-hub.js). ─────────────
const ch = read('public/career-hub.js');
check('Job Finder exposes an Auto-Apply action', /autoApply:\s*autoApply/.test(ch) && /function autoApply\(/.test(ch));
check('search results render an Auto-Apply button', /CareerHub\.autoApply\(/.test(ch));
check('apply queue is persisted (localStorage)', /rt_aa_queue/.test(ch) && /function aaEnqueue\(/.test(ch));
check('a "My Apply Queue" panel is rendered', /function renderApplyQueue\(/.test(ch) && /chApplyQueue/.test(ch));
check('a setup gate prompts before first queueing', /aaSetupDone\(\)/.test(ch) && /function openAaSetup\(/.test(ch));
check('removeFromQueue is exported', /removeFromQueue:\s*removeFromQueue/.test(ch));

// ── 4. Cross-linking: shared component + inclusion on every tool page. ────────
check('related-tools.js component exists', exists('public/related-tools.js'));
const rt = read('public/related-tools.js');
check('component omits the current page (self)', /norm\(t\.href\)\s*!==\s*here/.test(rt));
check('component lists the Auto-Applyer', /\/tools\/autoapply/.test(rt));
// Every required tool href appears in the component's inventory.
['/ai-resume-tailor', '/ai-cover-letter-generator', '/ats-score-checker', '/resume-analyzer',
 '/tools/ats-keyword-extractor', '/linkedin-optimizer', '/job-tracker', '/share-resume-link',
 '/resume-examples', '/cover-letter-examples', '/tools/salary-negotiation', '/tools/resume-ab-tracker',
 '/tools/offer-comparison', '/tools/job-description-decoder', '/tools/weekly-report',
 '/tools/follow-up-generator', '/tools/mock-interview', '/dashboard', '/tools/autoapply'
].forEach((href) => check('component links ' + href, rt.indexOf('\'' + href + '\'') !== -1 || rt.indexOf('"' + href + '"') !== -1));

// Every tool landing page includes the shared cross-link component.
const toolPages = [
  'public/tools/autoapply.html', 'public/tools/ats-keyword-extractor.html', 'public/tools/resume-video.html',
  'public/tools/follow-up-generator.html', 'public/tools/job-description-decoder.html', 'public/tools/mock-interview.html',
  'public/tools/offer-comparison.html', 'public/tools/resume-ab-tracker.html', 'public/tools/salary-negotiation.html',
  'public/tools/weekly-report.html', 'public/ai-resume-tailor.html', 'public/ai-cover-letter-generator.html',
  'public/ats-score-checker.html', 'public/resume-analyzer.html', 'public/job-tracker.html',
  'public/resume-examples.html', 'public/cover-letter-examples.html', 'public/share-resume-link.html'
];
toolPages.forEach((p) => check('includes related-tools.js: ' + p.replace('public/', ''),
  exists(p) && /src="\/related-tools\.js"/.test(read(p))));

// ── 5. The "Share Resume as a Link" landing page was created. ─────────────────
check('Share-as-a-Link landing page exists', exists('public/share-resume-link.html'));

if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
process.exit(0);
