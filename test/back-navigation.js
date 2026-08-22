#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const nav = read('public/back-nav.js');
const app = read('public/app.html');
const employer = read('public/employer.html');
const index = read('public/index.html');
const siteNav = read('public/site-nav.js');
let failed = 0;

function check(name, ok) {
  if (ok) console.log('PASS', name);
  else { console.error('FAIL', name); failed++; }
}

const staticRoutes = {
  '/ai-resume-tailor': '/score',
  '/ai-cover-letter-generator': '/score',
  '/ats-score-checker': '/score',
  '/resume-analyzer': '/score',
  '/job-tracker': '/score',
  '/score': '/tools',
  '/tools/offer-comparison': '/tools',
  '/tools/job-description-decoder': '/tools',
  '/tools/follow-up-generator': '/tools',
  '/tools/mock-interview': '/tools',
  '/tools/ats-keyword-extractor': '/tools',
  '/tools/resume-ab-tracker': '/tools',
  '/tools/salary-negotiation': '/tools',
  '/resume-examples': '/score',
  '/cover-letter-examples': '/score',
  '/tools/resume-video': '/tools',
  '/pricing': '/',
  '/checkout': '/pricing',
  '/for-employers': '/'
};

for (const [route, parent] of Object.entries(staticRoutes)) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  check(`${route} has explicit parent ${parent}`, new RegExp(`['"]${escaped}['"]\\s*:\\s*\\[['"]${parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(nav));
}

const appTabs = ['tailor','linkedin','ats','jobtracker','video','website','career','skillslab','interview','gap','jobfinder','scenariolab','forum','salary','checkin'];
for (const tab of appTabs) check(`app tab ${tab} is mapped`, new RegExp(`\\b${tab}:\\s*\\[`).test(nav));

check('Back navigation never calls history.back', !/history\s*\.\s*back\s*\(/.test(nav + app + employer));
check('shared site navigation loads explicit Back controls', /back-nav\.js/.test(siteNav));
check('checkout aliases load explicit Back controls', /back-nav\.js/.test(index));
check('lazy app panels mount Back controls after hydration', /hydratePanel\(name\)\.then\([\s\S]{0,300}RTBackNav\.refreshApp\(name\)/.test(app));
check('Share Link modal has explicit Free Tools parent', /id="shareModal"[\s\S]*?href="\/score"[^>]*aria-label="Back to Free Tools"/.test(app));
check('in-app checkout has explicit Pricing parent', /id="authSubscribeForm"[\s\S]{0,300}href="\/pricing"[^>]*aria-label="Back to Pricing"/.test(app));
check('Employer subpages map explicitly to dashboard', /refreshEmployer\(view\)[\s\S]*?nvGo\('dashboard'\)/.test(nav));
check('Employer dashboard maps explicitly to employer home', /view === 'dashboard'[\s\S]{0,200}makeLink\('\/for-employers'/.test(nav));
check('Employer auth and setup map explicitly to employer home', /\['nvAuth','nvSetup'\][\s\S]*?a\.href='\/for-employers'/.test(employer));

const pagesUsingSiteNav = [
  'public/ai-resume-tailor.html', 'public/ai-cover-letter-generator.html',
  'public/ats-score-checker.html', 'public/resume-analyzer.html',
  'public/job-tracker.html', 'public/score.html',
  'public/tools/offer-comparison.html', 'public/tools/job-description-decoder.html',
  'public/tools/follow-up-generator.html', 'public/tools/mock-interview.html',
  'public/tools/ats-keyword-extractor.html', 'public/tools/resume-ab-tracker.html',
  'public/tools/salary-negotiation.html', 'public/resume-examples.html',
  'public/cover-letter-examples.html', 'public/tools/resume-video.html'
];
for (const page of pagesUsingSiteNav) check(`${page} loads the shared navigation`, /site-nav\.js/.test(read(page)));

if (failed) {
  console.error(`\n${failed} Back-navigation regression check(s) failed.`);
  process.exit(1);
}
console.log('\nAll Back-navigation regression checks passed.');
