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
for (const [name, route] of [['Decoder Key','/decoder-key'],['Corporate','/corporate'],['Resume Video','/resume-video'],['Web Studio','/web-studio']]) {
  check(`${name} has a stable back path`, route === '/web-studio' ? /website:\s*\['\/tools', 'Back to New Tools'\]/.test(back) : back.includes(`'${route}'`));
}
const desktopLinks = [['Membership','/pricing#ecosystem-pricing'],['Tailor My Resume','/ai-resume-tailor'],['For Employer','/for-employers']];
check('homepage desktop toolbar contains exactly the three requested destinations', desktopLinks.every(([name, route]) => index.includes(`<a href="${route}">${name}</a>`)) && /club-nav__links[\s\S]{0,500}/.test(index));
check('shared desktop toolbar contains exactly the three requested destinations', desktopLinks.every(([name, route]) => siteNav.includes(`['${name}', '${route}'`)) && /var PRIMARY_LINKS = \[[\s\S]*?\];/.exec(siteNav)[0].match(/^\s*\[/gm).length === 3);
check('public HTML responses receive the shared toolbar while dashboards retain their own nav', /function _injectSharedPublicNav/.test(read('server.js')) && /ownNavPages = new Set\(\['app\.html', 'employer\.html', 'portal\.html'\]\)/.test(read('server.js')));
check('pillar pages load the shared explicit back control', ['public/decoder-key.html','public/corporate.html','public/portal.html'].every(file => read(file).includes('/back-nav.js')) && read('public/tools/resume-video.html').includes('/site-nav.js'));
check('homepage hamburger contains the complete tool directory', menuRoutes.every(route => index.includes(`href="${route}"`)));
check('shared hamburger contains the complete tool directory', menuRoutes.every(route => siteNav.includes(`'${route}'`)));
check('hamburger menus offer account creation and language switching', /club-mobile-menu__account[^>]+href="\/signup"/.test(index) && /data-club-lang/.test(index) && /data-snav-account/.test(siteNav) && /id="langToggleBtnMobile"/.test(siteNav));
check('hamburger menus do not expose Pricing', !/club-mobile-menu[\s\S]{0,2500}href="#pricing"/.test(index) && !/snavMenu[\s\S]{0,2500}href=["']#pricing/.test(siteNav));
check('mobile luxury header hides horizontal links and actions', /@media\(max-width:1000px\)\{\.club-nav__links,\.club-nav__actions\{display:none\}/.test(read('public/luxury-ecosystem.css')));
check('mobile bottom controls are scoped to the phone media query', /@media \(max-width: 480px\)[\s\S]{0,1200}position: fixed; bottom: 0;/.test(style));
check('mobile bottom controls have no desktop fixed rule', !/^\.sidebar\s*\{[^}]*position:\s*fixed/m.test(style));
check('reviewed product copy uses plain resume spelling', publicFiles.every(file => !/résumé/i.test(read(file))));

if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
