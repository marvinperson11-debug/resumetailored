#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let failures = 0;
function check(name, ok) { if (ok) console.log('PASS', name); else { failures++; console.error('FAIL', name); } }

const css = read('public/dashboard-luxury-unified.css');
const dashboards = ['public/app.html', 'public/employer.html', 'public/portal.html'].map(read);
check('shared dashboard stylesheet uses the exact homepage palette', ['#0a1628', '#1a4d3a', '#c9a227', '#f5f1e8'].every(color => css.includes(color)));
check('every dashboard loads the shared palette last', dashboards.every(html => /dashboard-luxury-unified\.css/.test(html)));
check('job seeker dashboard surfaces are covered', ['.dashboard', '.dash-main', '.tab-content', '.sidebar'].every(selector => css.includes(selector)));
check('employer dashboard surfaces are covered', ['.nv-sidebar', '.nv-topbar', '.nv-card', '.nv-stat'].every(selector => css.includes(selector)));
check('corporate back office surfaces are covered', ['.pt-wrap', '.pt-main', '.pt-card', '.pt-kpi'].every(selector => css.includes(selector)));
check('dashboard copy uses plain resume spelling', !dashboards.some(html => /résumé/i.test(html)));

if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
