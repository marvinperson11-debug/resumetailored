#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let failures = 0;
function check(name, ok) { if (ok) console.log('PASS', name); else { failures++; console.error('FAIL', name); } }

check('tailoring has a factual provider continuity fallback', /function _localTailorFallback/.test(src) && /Your original facts have been preserved/.test(src));
check('billing and capacity failures activate the fallback', /credit balance\|billing\|overloaded\|capacity\|timeout\|network\|fetch failed/.test(src));
check('fallback response is explicitly identified', /fallback: true/.test(src));
check('fallback supports resume, cover letter, and combined modes', /mode === 'resume'/.test(src) && /mode === 'cover_letter'/.test(src) && /===COVER_LETTER_START===/.test(src));
check('fallback copy uses plain resume spelling', !/résumé/i.test(src.match(/function _localTailorFallback[\s\S]*?\n}\n/)?.[0] || ''));

if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
