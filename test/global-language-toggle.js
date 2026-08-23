#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
let failures = 0;
function check(name, ok) { if (ok) console.log('PASS', name); else { failures++; console.error('FAIL', name); } }

const server = read('server.js');
const toggle = read('public/top-language-toggle.js');
check('every versioned HTML response receives the global language control', /const prepared = _injectSharedPublicNav\(_selfHostFonts\(_versionAssetRefs\(html\)\), filePath\);[\s\S]{0,100}res\.send\(_injectGlobalLanguageToggle\(prepared\)\)/.test(server));
check('the language control stays at the top of pages without a shared header', /position:fixed;top:12px;right:14px/.test(toggle));
check('pages with an existing top language control do not get a duplicate', /hasTopLanguageControl\(\)[\s\S]{0,100}data-global-language-toggle/.test(toggle));
check('Chinese selection routes to the Chinese experience', /location\.assign\('\/zh\/'\)/.test(toggle));
check('English selection safely returns to the originating page', /rt_language_return/.test(toggle) && /back\.charAt\(0\) === '\/'/.test(toggle));
check('the control uses the exact luxury palette', /#0a1628/.test(toggle) && /#1a4d3a/.test(toggle) && /#c9a227/.test(toggle) && /#f7f3e8/.test(toggle));
if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
