#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'portal.html'), 'utf8');
let failures = 0;
function check(name, ok) { if (ok) console.log('PASS', name); else { failures++; console.error('FAIL', name); } }

check('portal uses exact luxury palette', ['#0a1628', '#1a4d3a', '#c9a227'].every(c => html.includes(c)));
check('portal accepts secure cookie sessions', /credentials:'same-origin'/.test(html) && !/if\(!token\)\{gate\('Please sign in first\.'/ .test(html));
check('legacy bearer token remains supported', /if\(token\)x\.Authorization='Bearer '\+token/.test(html));
check('manager KPI grid stays restrained', /grid-template-columns:repeat\(3,minmax\(150px,1fr\)\)/.test(html));
check('record forms and lists use premium disclosure cards', /<details class="pt-card" id="ptForm">/.test(html) && /<details class="pt-card" open><summary>/.test(html));
check('portal header links across the product', ['/dashboard', '/employer', '/corporate', '/'].every(href => html.includes(`href="${href}"`)));
check('mobile layout remains responsive', /@media\(max-width:560px\)/.test(html));
check('copy uses plain resume spelling', !/résumé/i.test(html));

if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
