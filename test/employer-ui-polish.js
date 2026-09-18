#!/usr/bin/env node
/**
 * Guards for the employer-portal UI polish (3 items):
 *   1. Candidate emails send under the employer's business name
 *      (career_sites.company_name) via a fromName override; address unchanged.
 *   2. The Modal caps its height and scrolls its body internally so the bottom
 *      of a tall form (Record toggle / Schedule) is reachable on mobile.
 *   3. Dashboard stat cards are Links to their sections with hover/press.
 *
 * Usage: node test/employer-ui-polish.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const email = read('resumetailored-platform/lib/email.ts');
const careerStore = read('resumetailored-platform/lib/career-site-store.ts');
const notify = read('resumetailored-platform/lib/employer-notify.ts');
const ui = read('resumetailored-platform/app/employer/components/ui.tsx');
const dash = read('resumetailored-platform/app/employer/page.tsx');

// ── 1. Sender display name ──────────────────────────────────────────────────
check('sendEmail accepts fromName and applies it over the base From',
  /fromName\?:\s*string/.test(email) &&
  /export function fromWithName\(/.test(email) &&
  /fromWithName\(baseFrom,\s*opts\.fromName\)/.test(email));
check('fromWithName keeps the address, swaps only the display name',
  /<\(m \? m\[1\] : baseFrom\)/.test(email) || /const addr = \(m \? m\[1\] : baseFrom\)/.test(email));
check('read-only career-site company name lookup exists (no row creation)',
  /export async function getCareerSiteCompanyName\(/.test(careerStore) &&
  !/insert\(/.test(careerStore.slice(careerStore.indexOf('getCareerSiteCompanyName'), careerStore.indexOf('getCareerSiteCompanyName') + 400)));
check('notify derives fromName from career site and passes it on candidate sends',
  /getCareerSiteCompanyName\(employerId\)/.test(notify) &&
  (notify.match(/fromName:\s*ctx\.fromName/g) || []).length >= 3,
  'interview scheduled/cancelled + message emails must carry fromName');

// ── 2. Modal height + internal scroll ───────────────────────────────────────
check('Modal caps height with dvh and scrolls body internally',
  /max-h-\[calc\(100dvh/.test(ui) &&
  /flex-col/.test(ui) &&
  /min-h-0 flex-1 overflow-y-auto/.test(ui));

// ── 3. Dashboard stat cards are links ───────────────────────────────────────
check('stat cards carry hrefs to their sections',
  /href:\s*"\/employer\/jobs"/.test(dash) &&
  /href:\s*"\/employer\/candidates"/.test(dash) &&
  /href:\s*"\/employer\/team"/.test(dash));
check('stat cards render as Link with hover/press affordance',
  /<Link\s+[\s\S]*?href=\{c\.href\}[\s\S]*?hover:/.test(dash) &&
  /active:scale-\[0\.99\]/.test(dash));

if (failures) {
  console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('\nALL PASS (0 failures)');
process.exit(0);
