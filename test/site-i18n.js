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
const seed = (en, zh) => put.run(crypto.createHash('sha256').update(en).digest('hex'), 'zh', en, zh);
seed('Get Started Free', '免费开始');
seed('Frequently Asked Questions', '常见问题');
put.run(crypto.createHash('sha256').update('Get Started Free').digest('hex'), 'fr', 'Get Started Free', 'Commencer gratuitement');

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
check('client auto-applies the stored non-English language on load, for cross-page persistence', /function boot/.test(client) && /if \(lang === 'en'\) return/.test(client));
check('client supports all 5 languages (en + zh/es/hi/fr), not just zh', /TARGET_LANGS\s*=\s*\['zh',\s*'es',\s*'hi',\s*'fr'\]/.test(client));

// ── Server injection wiring (source-level) ───────────────────────────────────
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
// The homepage now gets site-i18n.js too (its own translator only covers
// EN/中文; this generically fills in es/hi/fr). Only the three app shells,
// matched by basename, are excluded — no more resolved-path homepage check.
const injectSiteI18nBody = (server.match(/function _injectSiteI18n\(html, filePath\) \{[\s\S]{0,700}?\n\}/) || [''])[0];
check('server excludes only the three app shells (homepage is no longer excluded)', /ownShells\.has\(path\.basename\(filePath\)\)/.test(injectSiteI18nBody) && !/isHomepage/.test(injectSiteI18nBody));
check('_injectSiteI18n is wired into the send pipeline', /_injectSiteI18n\(_injectSharedPublicNav\(/.test(server));
check('server supports 5 languages (I18N_TARGET_LANGS: zh/es/hi/fr)', /I18N_TARGET_LANGS\s*=\s*\{\s*zh:.*es:.*hi:.*fr:/.test(server));

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

    // 'fr' is now a supported target — a cache hit for it (seeded above) proves
    // the language is actually accepted, not just returning {} for lack of an
    // API key (which would look identical to "unsupported" from the outside).
    const fr = await req('POST', '/api/i18n/translate', { lang: 'fr', strings: ['Get Started Free'] });
    check('fr (a newly-supported language) returns its seeded cache hit', fr.status === 200 && fr.json.translations['Get Started Free'] === 'Commencer gratuitement', fr.body);

    const unsupported = await req('POST', '/api/i18n/translate', { lang: 'de', strings: ['Get Started Free'] });
    check('a genuinely unsupported language (de) returns empty even for a string cached under other languages', unsupported.status === 200 && Object.keys(unsupported.json.translations).length === 0);

    const bad = await req('POST', '/api/i18n/translate', { lang: 'zh', strings: 'not-an-array' });
    check('malformed body returns empty (never errors)', bad.status === 200 && Object.keys(bad.json.translations).length === 0);

    // ── Injection: SEO/blog pages and the homepage get the translator; only the
    // app shell (its own separate system) does not ──────────────────────────
    const seo = await req('GET', '/software-engineer-resume');
    check('an SEO page receives site-i18n.js', /src=["']\/site-i18n\.js/.test(seo.body), 'not injected');
    const blog = await req('GET', '/blog/');
    check('a directory index (blog) receives site-i18n.js', /src=["']\/site-i18n\.js/.test(blog.body));
    const home = await req('GET', '/');
    check('the homepage now receives site-i18n.js too (its own translator only covers EN/中文; this fills in es/hi/fr)', /src=["']\/site-i18n\.js/.test(home.body));
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
