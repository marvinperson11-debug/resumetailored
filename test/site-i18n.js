#!/usr/bin/env node
/**
 * Site-wide UI translator (site-i18n.js) — integration + contract.
 *
 * Boots the real Express app against a throwaway SQLite DB and drives the
 * /api/i18n/translate endpoint plus the HTML injection pipeline. Claude is never
 * called: the cache is pre-seeded the way a prior translation would have filled
 * it, so the cache-hit path, the fail-open paths, and the per-page injection are
 * all exercised for real with no API budget. Source-level checks pin the client
 * translator's contract (chaining, skip rules, restore).
 *
 * Usage: node test/site-i18n.js
 */
process.env.TOOLS_HASH_SALT = process.env.TOOLS_HASH_SALT || 'test-only-tools-hash-salt-0123456789'; // server.js refuses to boot without it
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-i18n-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
const Database = require('better-sqlite3');

// Seed the cache the way a prior (billed-once) translation would have.
const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
const put = db.prepare('INSERT OR IGNORE INTO i18n_cache (hash,lang,src,txt) VALUES (?,?,?,?)');
const seed = (en, lang, txt) => put.run(crypto.createHash('sha256').update(en).digest('hex'), lang, en, txt);
seed('Get Started Free', 'zh', '免费开始');
seed('Frequently Asked Questions', 'zh', '常见问题');
seed('Get Started Free', 'fr', 'Commencer gratuitement');
seed('Get Started Free', 'es', 'Empezar gratis');
seed('Get Started Free', 'hi', 'फ़्री में शुरू करें');

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', c => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, json: j, body: b }); });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// ── Client contract (source-level) ───────────────────────────────────────────
const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'site-i18n.js'), 'utf8');
check('client chains after an existing page translator', /pageApply\s*=\s*\(typeof window\.applyLang/.test(client) && /window\.applyLang\s*=\s*function/.test(client));
check('client skips the nav + language toggles', /#snav/.test(client) && /langToggleBtn/.test(client) && /notranslate/.test(client));
check('client translates key attributes too', /placeholder/.test(client) && /aria-label/.test(client) && /'alt'/.test(client));
check('client restores English from stored originals', /function restoreEn/.test(client) && /__i18nEn/.test(client));
check('client posts to the batch endpoint', /\/api\/i18n\/translate/.test(client));
check('client auto-applies the stored/guessed non-English locale on load (2026 5-locale widening)', /function boot/.test(client) && /lang\s*===\s*'en'/.test(client) && /LANGS\s*=\s*\[\s*'en',\s*'es',\s*'fr',\s*'hi',\s*'zh'\s*\]/.test(client));

// ── Server injection wiring (source-level) ───────────────────────────────────
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
check('server excludes the homepage by RESOLVED path, not basename', /_injectSiteI18n[\s\S]{0,400}path\.resolve\(filePath\) === path\.resolve\(path\.join\(__dirname, 'public', 'index\.html'\)\)/.test(server));
check('_injectSiteI18n is wired into the send pipeline', /_injectSiteI18n\(_injectSharedPublicNav\(/.test(server));
check('_MT_LANGS allowlist covers all 5 locales (2026 widening)', /_MT_LANGS\s*=\s*\{\s*es:\s*'Spanish',\s*fr:\s*'French',\s*hi:\s*'Hindi',\s*zh:\s*'Simplified Chinese'\s*\}/.test(server));

let PORT;
const srv = app.listen(0, async () => {
  PORT = srv.address().port;
  try {
    // ── Endpoint: cache hit, partial, fail-open, unsupported lang ─────────────
    const hit = await req('POST', '/api/i18n/translate', { lang: 'zh', strings: ['Get Started Free', 'An uncached phrase that no one seeded'] });
    check('endpoint returns seeded translation from cache', hit.status === 200 && hit.json.translations['Get Started Free'] === '免费开始', hit.body);
    check('endpoint omits an uncached string (no API key → fail open)', hit.json.translations['An uncached phrase that no one seeded'] === undefined);

    const many = await req('POST', '/api/i18n/translate', { lang: 'zh', strings: ['Frequently Asked Questions', 'Get Started Free'] });
    check('endpoint serves multiple cache hits', many.json.translations['Frequently Asked Questions'] === '常见问题' && many.json.translations['Get Started Free'] === '免费开始');

    // ── 2026 5-locale widening: es/fr/hi are now allowlisted alongside zh ──────
    const fr = await req('POST', '/api/i18n/translate', { lang: 'fr', strings: ['Get Started Free'] });
    check('fr is allowlisted and serves its own cache hit', fr.status === 200 && fr.json.translations['Get Started Free'] === 'Commencer gratuitement', fr.body);
    const es = await req('POST', '/api/i18n/translate', { lang: 'es', strings: ['Get Started Free'] });
    check('es is allowlisted and serves its own cache hit', es.status === 200 && es.json.translations['Get Started Free'] === 'Empezar gratis', es.body);
    const hi = await req('POST', '/api/i18n/translate', { lang: 'hi', strings: ['Get Started Free'] });
    check('hi is allowlisted and serves its own cache hit', hi.status === 200 && hi.json.translations['Get Started Free'] === 'फ़्री में शुरू करें', hi.body);
    check('each locale has its own cache row — fr/es/hi/zh translations never bleed into each other',
      fr.json.translations['Get Started Free'] !== es.json.translations['Get Started Free'] &&
      es.json.translations['Get Started Free'] !== hi.json.translations['Get Started Free'] &&
      hi.json.translations['Get Started Free'] !== many.json.translations['Get Started Free']);

    const unsupported = await req('POST', '/api/i18n/translate', { lang: 'de', strings: ['Hello'] });
    check('a genuinely unsupported language (not in the allowlist) returns empty (never errors)', unsupported.status === 200 && Object.keys(unsupported.json.translations).length === 0);

    const bad = await req('POST', '/api/i18n/translate', { lang: 'zh', strings: 'not-an-array' });
    check('malformed body returns empty (never errors)', bad.status === 200 && Object.keys(bad.json.translations).length === 0);

    // ── Injection: SEO/blog pages get the translator; homepage + app do not ───
    const seo = await req('GET', '/software-engineer-resume');
    check('an SEO page receives site-i18n.js', /src=["']\/site-i18n\.js/.test(seo.body), 'not injected');
    const blog = await req('GET', '/blog/');
    check('a directory index (blog) receives site-i18n.js', /src=["']\/site-i18n\.js/.test(blog.body));
    const home = await req('GET', '/');
    check('the homepage does NOT receive site-i18n.js (has its own translator)', !/src=["']\/site-i18n\.js/.test(home.body));
    const appShell = await req('GET', '/dashboard');
    check('the app shell does NOT receive site-i18n.js', !/src=["']\/site-i18n\.js/.test(appShell.body));
  } catch (e) {
    console.error('THREW', e && e.stack ? e.stack : e); failures++;
  } finally {
    srv.close();
    if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
    console.log('\nALL PASS (0 failures)');
    process.exit(0);
  }
});
