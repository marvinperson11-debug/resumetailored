#!/usr/bin/env node
/*
 * test-redirects.js — Scope 3 + 4 redirect smoke checks for the Oct 2026 audit.
 * Verifies server.js registers the 301s and no stale internal refs remain.
 * Run: node test-redirects.js
 */
'use strict';
const fs = require('fs');
const s = fs.readFileSync('server.js', 'utf8');

let fail = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' → ' + detail : ''));
  if (!ok) fail++;
}

check(
  '/employer → /for-employers 301',
  /app\.get\(\['\/employer', '\/employer\.html'\][\s\S]{0,300}res\.redirect\(301, `\/for-employers/.test(s)
);
check(
  '/ats-score-checker → /free-ats-resume-checker 301',
  /app\.get\(\['\/ats-score-checker', '\/ats-score-checker\.html'\][\s\S]{0,300}res\.redirect\(301, `\/free-ats-resume-checker/.test(s)
);
check(
  '/dashboard pure-employer → app directly',
  s.includes("res.redirect(302, 'https://app.resumetailored.com/employer')")
);

// No stale internal /employer refs (the 301 route itself is expected)
const stale = s.split('\n').filter((l) => {
  if (l.includes('/for-employers')) return false;
  if (l.includes('app.resumetailored.com/employer')) return false;
  if (l.trim().startsWith('//')) return false;
  if (l.includes("app.get(['/employer'")) return false;
  return l.includes("'/employer'") || l.includes('"/employer"');
});
check('no stale /employer refs in server.js', stale.length === 0,
  stale.length ? stale.slice(0, 2).map((x) => x.trim()).join(' | ') : '');

// HTML link checks
const idx = fs.readFileSync('public/index.html', 'utf8');
check('related-tools.js points to canonical ATS URL',
  fs.readFileSync('public/related-tools.js', 'utf8').includes("href: '/free-ats-resume-checker'"));
check('score.html points to canonical ATS URL',
  fs.readFileSync('public/score.html', 'utf8').includes('href="/free-ats-resume-checker"'));
check('sitemap has no /ats-score-checker',
  !fs.readFileSync('public/sitemap.xml', 'utf8').includes('/ats-score-checker'));
check('sitemap keeps /free-ats-resume-checker',
  fs.readFileSync('public/sitemap.xml', 'utf8').includes('/free-ats-resume-checker'));
check('llms.txt has no /ats-score-checker',
  !fs.readFileSync('public/llms.txt', 'utf8').includes('/ats-score-checker'));
check('portal.html employer links → app directly',
  (fs.readFileSync('public/portal.html', 'utf8').match(/https:\/\/app\.resumetailored\.com\/employer/g) || []).length >= 2);
check('pro-tools Employer Portal card → app directly',
  fs.readFileSync('public/pro-tools.html', 'utf8').includes('href="https://app.resumetailored.com/employer"'));
check('index.html promo Employer Portal card → /for-employers',
  idx.includes('href="/for-employers"') && idx.includes('data-i18n="promo1_cta"'));
check('index.html promo Career Hub card → /career-hub',
  idx.includes('href="/career-hub"') && idx.includes('data-i18n="promo5_cta"'));

process.exit(fail ? 1 : 0);
