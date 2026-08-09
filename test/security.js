/* test/security.js — pure security-logic core (no server boot, no network).
 * Run: node test/security.js  → prints ALL PASS or the failures. */
'use strict';
const assert = require('assert');
const SC = require('../security.js');

const failures = [];
async function ok(name, fn) {
  try { await fn(); console.log('  ✓', name); }
  catch (e) { failures.push(name + ' — ' + e.message); console.log('  ✗', name, '—', e.message); }
}

(async () => {

console.log('validatePasswordPolicy');
await ok('rejects short passwords', () => {
  assert.equal(SC.validatePasswordPolicy('Ab1!').ok, false);
});
await ok('rejects missing uppercase', () => {
  assert.equal(SC.validatePasswordPolicy('lowercase1!').ok, false);
});
await ok('rejects missing lowercase', () => {
  assert.equal(SC.validatePasswordPolicy('UPPERCASE1!').ok, false);
});
await ok('rejects missing digit', () => {
  assert.equal(SC.validatePasswordPolicy('NoDigitsHere!').ok, false);
});
await ok('rejects missing symbol', () => {
  assert.equal(SC.validatePasswordPolicy('NoSymbols123').ok, false);
});
await ok('accepts a compliant password', () => {
  assert.equal(SC.validatePasswordPolicy('Str0ng!Pass').ok, true);
});
await ok('rejects non-string input without throwing', () => {
  assert.equal(SC.validatePasswordPolicy(undefined).ok, false);
  assert.equal(SC.validatePasswordPolicy(12345678).ok, false);
});

console.log('checkPwnedPassword');
await ok('reports a match from the range response (k-anonymity)', async () => {
  // SHA-1('password') = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8 -> prefix 5BAA6, suffix rest
  const fakeFetch = async (url) => {
    assert.ok(url.includes('5BAA6'), 'only the 5-char prefix is sent');
    return { ok: true, text: async () => '1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\nOTHERSUFFIX:2' };
  };
  const r = await SC.checkPwnedPassword('password', fakeFetch);
  assert.equal(r.checked, true);
  assert.equal(r.pwned, true);
  assert.equal(r.count, 3730471);
});
await ok('reports no match when suffix absent from the range', async () => {
  const fakeFetch = async () => ({ ok: true, text: async () => 'DEADBEEF00000000000000000000000000:1' });
  const r = await SC.checkPwnedPassword('Str0ng!Pass9x', fakeFetch);
  assert.equal(r.checked, true);
  assert.equal(r.pwned, false);
});
await ok('fails OPEN on network error (never blocks signup)', async () => {
  const fakeFetch = async () => { throw new Error('network down'); };
  const r = await SC.checkPwnedPassword('anything', fakeFetch);
  assert.equal(r.checked, false);
  assert.equal(r.pwned, false);
});
await ok('fails OPEN on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 503 });
  const r = await SC.checkPwnedPassword('anything', fakeFetch);
  assert.equal(r.checked, false);
  assert.equal(r.pwned, false);
});
await ok('never sends the password itself, only a truncated SHA-1 prefix', async () => {
  let capturedUrl = '';
  const fakeFetch = async (url) => { capturedUrl = url; return { ok: true, text: async () => '' }; };
  await SC.checkPwnedPassword('correct horse battery staple', fakeFetch);
  assert.ok(!capturedUrl.includes('correct'), 'plaintext password never appears in the request URL');
  assert.equal(capturedUrl.match(/range\/([0-9A-F]{5})$/)[1].length, 5);
});

console.log('createLockoutTracker');
await ok('allows attempts under the threshold', () => {
  const t = SC.createLockoutTracker({ windowMs: 1000, maxAttempts: 5, lockoutMs: 5000 });
  for (let i = 0; i < 4; i++) t.recordFailure('1.2.3.4');
  assert.equal(t.check('1.2.3.4').locked, false);
});
await ok('locks out after maxAttempts failures', () => {
  const t = SC.createLockoutTracker({ windowMs: 1000, maxAttempts: 5, lockoutMs: 5000 });
  for (let i = 0; i < 5; i++) t.recordFailure('9.9.9.9');
  const r = t.check('9.9.9.9');
  assert.equal(r.locked, true);
  assert.ok(r.retryAfterSec > 0);
});
await ok('lockout outlasts the counting window (the whole point of a two-tier scheme)', () => {
  const t = SC.createLockoutTracker({ windowMs: 10, maxAttempts: 3, lockoutMs: 5000 });
  for (let i = 0; i < 3; i++) t.recordFailure('a');
  assert.equal(t.check('a').locked, true, 'still locked well after the short counting window would have expired');
});
await ok('clear() lifts a lockout immediately (successful login resets)', () => {
  const t = SC.createLockoutTracker({ windowMs: 1000, maxAttempts: 3, lockoutMs: 5000 });
  for (let i = 0; i < 3; i++) t.recordFailure('b');
  assert.equal(t.check('b').locked, true);
  t.clear('b');
  assert.equal(t.check('b').locked, false);
});
await ok('keys are independent (one IP locking out does not affect another)', () => {
  const t = SC.createLockoutTracker({ windowMs: 1000, maxAttempts: 2, lockoutMs: 5000 });
  t.recordFailure('x'); t.recordFailure('x');
  assert.equal(t.check('x').locked, true);
  assert.equal(t.check('y').locked, false);
});

console.log('scrubForLog');
await ok('redacts password/token/secret/apiKey fields', () => {
  const out = SC.scrubForLog({ email: 'a@b.com', password: 'hunter2', token: 'tok', apiKey: 'sk_live_x', nested: { authorization: 'Bearer x' } });
  assert.equal(out.email, 'a@b.com');
  assert.equal(out.password, '[REDACTED]');
  assert.equal(out.token, '[REDACTED]');
  assert.equal(out.apiKey, '[REDACTED]');
  assert.equal(out.nested.authorization, '[REDACTED]');
});
await ok('leaves non-sensitive fields and primitives untouched', () => {
  assert.equal(SC.scrubForLog('plain string'), 'plain string');
  assert.equal(SC.scrubForLog(42), 42);
  assert.equal(SC.scrubForLog(null), null);
  const out = SC.scrubForLog({ name: 'Jane', count: 3 });
  assert.deepEqual(out, { name: 'Jane', count: 3 });
});
await ok('handles arrays and Error objects without throwing', () => {
  const out = SC.scrubForLog([{ password: 'x' }, new Error('boom')]);
  assert.equal(out[0].password, '[REDACTED]');
  assert.equal(out[1].message, 'boom');
});

console.log('buildCorsOriginChecker');
await ok('allows the production hosts', () => {
  const isAllowed = SC.buildCorsOriginChecker();
  assert.equal(isAllowed('https://resumetailored.com'), true);
  assert.equal(isAllowed('https://www.resumetailored.com'), true);
});
await ok('allows *.resumetailored.com subdomains (personal sites)', () => {
  const isAllowed = SC.buildCorsOriginChecker();
  assert.equal(isAllowed('https://alexjohnson.resumetailored.com'), true);
});
await ok('allows requests with no Origin header (server-to-server, same-origin)', () => {
  const isAllowed = SC.buildCorsOriginChecker();
  assert.equal(isAllowed(undefined), true);
  assert.equal(isAllowed(''), true);
});
await ok('allows localhost for local dev', () => {
  const isAllowed = SC.buildCorsOriginChecker();
  assert.equal(isAllowed('http://localhost:3000'), true);
});
await ok('rejects an arbitrary third-party origin — no wildcard', () => {
  const isAllowed = SC.buildCorsOriginChecker();
  assert.equal(isAllowed('https://evil.example.com'), false);
});
await ok('rejects a lookalike domain (resumetailored.com.evil.com)', () => {
  const isAllowed = SC.buildCorsOriginChecker();
  assert.equal(isAllowed('https://resumetailored.com.evil.com'), false);
});
await ok('rejects a malformed origin header instead of throwing', () => {
  const isAllowed = SC.buildCorsOriginChecker();
  assert.equal(isAllowed('not-a-url'), false);
});

console.log('buildCSP');
await ok('locks default-src to self and covers every real external dependency', () => {
  const csp = SC.buildCSP();
  assert.ok(csp.includes("default-src 'self'"));
  // Every third-party host actually loaded by the app somewhere (verified by
  // grepping public/ + a live Playwright console-violation check) must be
  // present, or that page breaks the moment this header goes live.
  for (const host of [
    'api.anthropic.com', 'api.stripe.com', 'api.elevenlabs.io', // server-called / browser-direct APIs
    'fonts.googleapis.com', 'fonts.gstatic.com',                // Google Fonts (app.html signature-font picker)
    'www.googletagmanager.com',                                 // Google Analytics (still on every page)
    'cdnjs.cloudflare.com',                                     // jsPDF
    'esm.sh',                                                   // /preview's React/Remotion import map
    'static.cloudflareinsights.com', 'cloudflareinsights.com', // Cloudflare Web Analytics beacon (edge-injected)
  ]) {
    assert.ok(csp.includes(host), `CSP missing ${host}`);
  }
  assert.ok(!csp.includes('api.openai.com'), 'this app calls Anthropic, not OpenAI — should not appear');
  // AdSense was removed from the whole product, so its ad-network allowances are
  // pruned from the CSP — no page references them (guards against them creeping back).
  for (const dead of ['pagead2.googlesyndication.com', 'googlesyndication.com', 'doubleclick.net']) {
    assert.ok(!csp.includes(dead), `CSP should no longer allow ${dead} (AdSense removed)`);
  }
});

console.log('escapeHtml');
await ok('escapes the five standard entities', () => {
  assert.equal(SC.escapeHtml(`<script>&"'`), '&lt;script&gt;&amp;&quot;&#39;');
});
await ok('handles null/undefined without throwing', () => {
  assert.equal(SC.escapeHtml(null), '');
  assert.equal(SC.escapeHtml(undefined), '');
});

console.log('timingSafeEqualStr');
await ok('true for equal strings', () => {
  assert.equal(SC.timingSafeEqualStr('correct-secret', 'correct-secret'), true);
});
await ok('false for different strings of the same length', () => {
  assert.equal(SC.timingSafeEqualStr('correct-secret', 'wrong-secretxx'), false);
});
await ok('false for different-length strings, does not throw', () => {
  assert.equal(SC.timingSafeEqualStr('short', 'a-much-longer-string'), false);
});
await ok('false for non-string input', () => {
  assert.equal(SC.timingSafeEqualStr(undefined, 'x'), false);
  assert.equal(SC.timingSafeEqualStr(null, null), false);
});

if (failures.length) { console.log('\nFAILURES:\n' + failures.map(f => ' - ' + f).join('\n')); process.exit(1); }
console.log('\nALL PASS');
})();
