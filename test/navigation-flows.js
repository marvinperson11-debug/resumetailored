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
const siteNav = read('public/site-nav.js');
const publicFiles = ['public/index.html', 'public/app.html', 'public/decoder-key.html', 'public/corporate.html', 'public/portal.html', 'public/js/i18n-data.js'];
const menuRoutes = ['/ai-resume-tailor','/ai-cover-letter-generator','/free-ats-resume-checker','/linkedin-optimizer','/resume-video','/web-studio','/decoder-key','/interview-coach','/career-hub'];

check('homepage Tailor My Resume door opens its explanation page', /class="ecosystem-door" href="\/ai-resume-tailor" data-context="job-seeker"/.test(index));
check('homepage Employers door opens the employer entry', /class="ecosystem-door" href="\/for-employers" data-context="employer"/.test(index));
// The in-page Back control has been removed — users rely on the browser's
// native Back button. back-nav.js no longer maps parent routes; it is a
// teardown/no-op that strips any legacy back controls.
check('back-nav.js no longer maps static parent routes (back button removed)', !/STATIC_PARENTS/.test(back) && !/'\/decoder-key'\s*:/.test(back) && /function removeBackControls\(/.test(back));
const desktopLinks = [['Membership','/pricing#ecosystem-pricing'],['Tailor My Resume','/ai-resume-tailor'],['For Employer','/for-employers']];
// The club-nav links now carry a data-i18n attribute (so the toggle translates
// them), so match href + visible label tolerantly rather than as an exact tag.
check('homepage desktop toolbar contains exactly the three requested destinations', desktopLinks.every(([name, route]) => new RegExp(`<a href="${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>${name}</a>`).test(index)) && /club-nav__links[\s\S]{0,500}/.test(index));
check('shared desktop toolbar contains exactly the three requested destinations', desktopLinks.every(([name, route]) => siteNav.includes(`['${name}', '${route}'`)) && /var PRIMARY_LINKS = \[[\s\S]*?\];/.exec(siteNav)[0].match(/^\s*\[/gm).length === 3);
check('public HTML responses receive the shared toolbar while dashboards retain their own nav', /function _injectSharedPublicNav/.test(read('server.js')) && /ownNavPages = new Set\(\['app\.html', 'employer\.html', 'portal\.html'\]\)/.test(read('server.js')));
check('pillar pages still load back-nav.js (now the back-control teardown)', ['public/decoder-key.html','public/corporate.html','public/portal.html'].every(file => read(file).includes('/back-nav.js')) && read('public/tools/resume-video.html').includes('/site-nav.js'));
check('homepage hamburger contains the complete tool directory', menuRoutes.every(route => index.includes(`href="${route}"`)));
check('shared hamburger contains the complete tool directory', menuRoutes.every(route => siteNav.includes(`'${route}'`)));
// 中文 has been MOVED OUT of the hamburger and onto the always-visible top-nav
// actions cluster (beside Login + the hamburger), on both the homepage's
// club-nav and the shared site-nav. Account creation still lives in the hamburger.
check('nav offers account creation in the hamburger and language switching on the top bar', /club-mobile-menu__account[^>]+href="\/signup"/.test(index) && /data-snav-account/.test(siteNav) && /class="club-nav__lang"[^>]*data-club-lang-top/.test(index) && /id="langToggleBtn"/.test(siteNav) && /class="snav-lang"/.test(siteNav) && !/id="langToggleBtnMobile"/.test(siteNav));
check('hamburger menus do not expose Pricing', !/club-mobile-menu[\s\S]{0,2500}href="#pricing"/.test(index) && !/snavMenu[\s\S]{0,2500}href=["']#pricing/.test(siteNav));
// Mobile header hides the horizontal LINKS but keeps the actions cluster
// (中文 + Login) visible beside the hamburger at every width.
check('mobile luxury header hides links but keeps the actions cluster visible', /@media\(max-width:1000px\)\{\.club-nav__links\{display:none\}/.test(read('public/luxury-ecosystem.css')) && !/\.club-nav__links,\.club-nav__actions\{display:none\}/.test(read('public/luxury-ecosystem.css')));
check('mobile bottom controls are scoped to the phone media query', /@media \(max-width: 480px\)[\s\S]{0,1200}position: fixed; bottom: 0;/.test(style));
check('mobile bottom controls have no desktop fixed rule', !/^\.sidebar\s*\{[^}]*position:\s*fixed/m.test(style));
check('reviewed product copy uses plain resume spelling', publicFiles.every(file => !/résumé/i.test(read(file))));

if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
