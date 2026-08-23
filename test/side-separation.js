#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let failures = 0;
function check(name, ok) { if (ok) console.log('PASS', name); else { failures++; console.error('FAIL', name); } }

const app = read('public/app.html');
const employer = read('public/employer.html');
const portal = read('public/portal.html');
const corporate = read('public/corporate.html');
const nav = read('public/site-nav.js');
const index = read('public/index.html');

check('job-seeker dashboard contains no employer entry card', !/id="authEmployerCta"|<h3>Employer Portal<\/h3>|href="\/employer"/.test(app));
check('employer dashboard contains no job-seeker navigation', !/href="\/(?:dashboard|score|pro-tools|ai-resume-tailor|resume-video|web-studio|career-hub|decoder-key)"/.test(employer));
check('corporate back office contains employer navigation only', !/href="\/dashboard"|>Job Seeker</.test(portal) && /Employer Dashboard/.test(portal));
check('Corporate mobile menu contains no job-seeker tools', !/cpHeaderMenu[\s\S]{0,1500}href="\/(?:ai-resume-tailor|ai-cover-letter-generator|free-ats-resume-checker|linkedin-optimizer|resume-video|web-studio|decoder-key|interview-coach|career-hub)"/.test(corporate));
check('shared mobile directory switches to employer-only links on employer pages', /var EMPLOYER_LINKS/.test(nav) && /employerSide \? EMPLOYER_LINKS : LINKS/.test(nav));
check('job-seeker homepage pillars contain no employer tool card', !/class="pillar-card" href="\/corporate"/.test(index));
check('Employer Decoder deep link stays inside the employer portal', /Recruitment Decoder', '\/employer\?view=decoder'/.test(nav) && /requestedView==='decoder'\?'decoder':'dashboard'/.test(employer));

if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
