#!/usr/bin/env node
/**
 * Static-asset caching + rate-limit message shape — regression guards.
 *
 * Two real production bugs, found from live screenshots showing three merged
 * "fix" PRs (mobile contrast, tab-bar clipping, dashboard refresh) visibly
 * doing nothing: CSS/JS were served with a 24h public cache while their HTML
 * stayed no-cache, so a returning browser kept rendering fresh markup against
 * a day-old stylesheet/script. And separately, the global apiLimiter's 429
 * body carried only `error`, no `message` — every frontend call site reads
 * `res.data.message || <fallback>`, so a rate-limited request silently
 * degraded to a generic "Search failed." instead of the real reason.
 *
 * Both are static-analysis checks (source text, not a live cache or a live
 * rate-limit trip) — cheap, deterministic, and they fail loudly if either
 * regresses back to the shape that caused this.
 *
 * Usage: node test/static-asset-caching.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// ── static asset Cache-Control ──────────────────────────────────────────────
const staticBlockMatch = src.match(/app\.use\(express\.static\([\s\S]*?setHeaders:[\s\S]*?\n  \}\n\}\)\);/);
check('found the express.static setHeaders block', !!staticBlockMatch);
const staticBlock = staticBlockMatch ? staticBlockMatch[0] : '';

check('.css is no longer served with a long public cache (was the root cause)', !/\.css['")][\s\S]{0,200}max-age=86400/.test(staticBlock));
check('.js is no longer served with a long public cache for non-coupled modules', !/\.js['")][\s\S]{0,400}max-age=86400/.test(staticBlock));
// Both branches should set no-cache (still allows a cheap ETag 304, not "no store").
const cssBranch = staticBlock.match(/endsWith\('\.css'\)\)[\s\S]*?(?=\} else if)/);
check("the .css branch sets Cache-Control: no-cache", !!cssBranch && /Cache-Control['"]?,\s*['"]no-cache['"]/.test(cssBranch[0]), cssBranch && cssBranch[0]);
const jsBranch = staticBlock.match(/endsWith\('\.js'\)\)[\s\S]*?(?=\} else if)/);
check("the .js branch sets Cache-Control: no-cache", !!jsBranch && /Cache-Control['"]?,\s*['"]no-cache['"]/.test(jsBranch[0]), jsBranch && jsBranch[0]);
// Images/fonts are a separate, intentional exception — genuinely rarely change.
const imageFontBranch = staticBlock.split('woff2?')[1] || '';
check('images/fonts keep their long cache (not part of this bug, not touched)', imageFontBranch.slice(0, 250).includes('max-age=2592000'), imageFontBranch.slice(0, 100));

// ── rate-limit message shape ────────────────────────────────────────────────
// Every `rateLimit({ ... message: { ... } ... })` call's message object must
// carry a `message` key, not just `error` — see the header comment for why.
const limiterCalls = [...src.matchAll(/rateLimit\(\{[\s\S]*?\}\);?/g)].map(m => m[0]);
check('found rateLimit(...) calls to check', limiterCalls.length >= 5, String(limiterCalls.length));
let allHaveMessageField = true;
const offenders = [];
for (const call of limiterCalls) {
  const msgObjMatch = call.match(/message:\s*\{([^}]*)\}/);
  if (!msgObjMatch) continue; // no custom message body — express-rate-limit's default applies, not this bug
  const body = msgObjMatch[1];
  if (!/\bmessage\s*:/.test(body)) { allHaveMessageField = false; offenders.push(call.slice(0, 80)); }
}
check('every custom rate-limit message body includes a `message` field', allHaveMessageField, offenders.join(' | '));

if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
process.exit(0);
