#!/usr/bin/env node
'use strict';
// Guards the serve-time luxury palette repaint that keeps every public HTML page
// on the canonical navy/emerald/gold palette without hand-editing hundreds of
// generated role/tool pages.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
let failures = 0;
function check(name, ok) { if (ok) console.log('PASS', name); else { failures++; console.error('FAIL', name); } }

check('repaint runs inside the single HTML send path', /_luxuryRepaint\(html, filePath\)/.test(server) && /function _luxuryRepaint\(/.test(server));
check('legacy near-black background maps to canonical navy', /#030712\/gi, '#0a1628'/.test(server) || /\[\/#030712\/gi, '#0a1628'\]/.test(server));
check('deep green accent maps to emerald', /#1F5C3D\/gi, '#1a4d3a'/.test(server) || /\[\/#1F5C3D\/gi, '#1a4d3a'\]/.test(server));
check('bright mint highlight maps to gold', /#8FD3AC\/gi, '#c9a227'/.test(server) || /\[\/#8FD3AC\/gi, '#c9a227'\]/.test(server));
check('green rgba tint maps to emerald rgba', /rgba\\\(\\s\*31/.test(server));
check('the three app shells are excluded from the repaint', /_LUXURY_SHELL_PAGES = new Set\(\['app\.html', 'employer\.html', 'portal\.html'\]\)/.test(server) && /_LUXURY_SHELL_PAGES\.has\(path\.basename\(filePath\)\)/.test(server));

if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
