#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let failures = 0;
function check(name, ok) { if (ok) console.log('PASS', name); else { failures++; console.error('FAIL', name); } }

const index = read('public/index.html');
const back = read('public/back-nav.js');
const style = read('public/style.css');
const publicFiles = ['public/index.html', 'public/app.html', 'public/decoder-key.html', 'public/corporate.html', 'public/portal.html', 'public/js/i18n-data.js'];

check('homepage Tailor My Resume door opens the job-seeker dashboard', /class="ecosystem-door" href="\/dashboard" data-context="job-seeker"/.test(index));
check('homepage Employers door opens the employer entry', /class="ecosystem-door" href="\/for-employers" data-context="employer"/.test(index));
for (const [name, route] of [['Decoder Key','/decoder-key'],['Corporate','/corporate'],['Resume Video','/resume-video'],['Web Studio','/web-studio']]) {
  check(`${name} is linked in primary ecosystem navigation`, new RegExp(`<a href="${route}">${name}</a>`).test(index));
  check(`${name} has a stable back path`, route === '/web-studio' ? /website:\s*\['\/tools', 'Back to New Tools'\]/.test(back) : back.includes(`'${route}'`));
}
check('pillar pages load the shared explicit back control', ['public/decoder-key.html','public/corporate.html','public/portal.html'].every(file => read(file).includes('/back-nav.js')) && read('public/tools/resume-video.html').includes('/site-nav.js'));
check('mobile bottom controls are scoped to the phone media query', /@media \(max-width: 480px\)[\s\S]{0,1200}position: fixed; bottom: 0;/.test(style));
check('mobile bottom controls have no desktop fixed rule', !/^\.sidebar\s*\{[^}]*position:\s*fixed/m.test(style));
check('reviewed product copy uses plain resume spelling', publicFiles.every(file => !/résumé/i.test(read(file))));

if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
