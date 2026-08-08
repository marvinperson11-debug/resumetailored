#!/usr/bin/env node
/**
 * HTML asset-version rewriting + routing — live integration test.
 *
 * Cache-Control alone isn't enough to fix the "shipped CSS/JS fixes don't
 * reach real browsers" bug: Cloudflare (in front of Railway) overrides
 * Cache-Control for .css/.js with its own fixed Browser Cache TTL regardless
 * of what origin sends (confirmed live — origin sent `no-cache`, the
 * response a browser actually received said `max-age=14400`). The durable
 * fix is version-stamping the asset REFERENCES inside every HTML response
 * (?v=<build>), so a content change is a brand-new URL — a guaranteed cache
 * miss no matter what any intermediary does with Cache-Control.
 *
 * This boots the real app and drives real HTTP requests because the whole
 * point is routing behavior (which handler answers which URL, in what
 * order) — a static-analysis check of the source wouldn't catch a route
 * ordering mistake that shadows an existing page or an API endpoint.
 *
 * Usage: node test/html-asset-versioning.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-htmlver-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

function req(method, urlPath) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', c => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    r.end();
  });
}

let PORT;
const server = app.listen(0, async () => {
  PORT = server.address().port;
  try {
    // ── every asset reference in real pages carries the version param ────────
    const score = await req('GET', '/score');
    check('/score responds 200', score.status === 200);
    check('/score versions its theme.css reference', /href="\/theme\.css\?v=[^"]+"/.test(score.body), score.body.match(/href="\/theme\.css[^"]*"/));

    const dashboard = await req('GET', '/dashboard');
    check('/dashboard responds 200', dashboard.status === 200);
    check('/dashboard versions style.css (virtual route, not static-file-backed)', /href="style\.css\?v=[^"]+"/.test(dashboard.body));
    check('/dashboard versions career-hub.js', /src="\/career-hub\.js\?v=[^"]+"/.test(dashboard.body));
    check('/dashboard versions career-hub.css', /href="\/career-hub\.css\?v=[^"]+"/.test(dashboard.body));
    check('/dashboard versions app-theme.css', /href="\/app-theme\.css\?v=[^"]+"/.test(dashboard.body));
    // /login and /signup now serve the dedicated login page (not the app), still
    // through the versioning path — its assets must be versioned too.
    const login = await req('GET', '/login');
    check('/login serves the login page, versioned', /Log in \/ Sign up/.test(login.body) && /src="\/login-redirect\.js\?v=[^"]+"/.test(login.body) && /href="\/theme\.css\?v=[^"]+"/.test(login.body), login.body.slice(0, 100));
    const signup = await req('GET', '/signup');
    check('/signup serves the login page, versioned', /Log in \/ Sign up/.test(signup.body) && /src="\/login-redirect\.js\?v=[^"]+"/.test(signup.body));

    const blog = await req('GET', '/blog');
    check('/blog (explicit sendFile-replacement route) versions theme.css', /href="\/theme\.css\?v=[^"]+"/.test(blog.body));

    // The Employer Portal page is self-contained (inline styles, no shared local
    // stylesheet/script), so there is nothing to version — which sidesteps the
    // stale-cache problem entirely. Assert it serves and has no UNVERSIONED
    // local .css/.js reference (guards against a future asset being added
    // without a version stamp).
    const employer = await req('GET', '/employer');
    check('/employer serves', employer.status === 200);
    // A local asset ref with no ?v= query would be unversioned (cache-stale risk).
    const empUnversioned = /(?:href|src)="\/[^"?]+\.(?:css|js)"/.test(employer.body);
    check('/employer has no unversioned local .css/.js reference', !empUnversioned);

    // ── the version is the SAME across pages in one boot (one ASSET_VERSION) ──
    const v1 = (score.body.match(/theme\.css\?v=([^"]+)"/) || [])[1];
    const v2 = (blog.body.match(/theme\.css\?v=([^"]+)"/) || [])[1];
    check('the same version stamp is used across every page (one deploy = one version)', !!v1 && v1 === v2, `${v1} vs ${v2}`);

    // ── the actual asset files are untouched by the rewrite (no accidental HTML interception) ──
    const themeCss = await req('GET', '/theme.css');
    check('/theme.css itself still serves as CSS, not swallowed by the HTML catch-all', themeCss.status === 200 && themeCss.headers['content-type'].includes('text/css'), themeCss.headers['content-type']);
    check('/theme.css has no-cache (still revalidates)', themeCss.headers['cache-control'] === 'no-cache');
    const chJs = await req('GET', '/career-hub.js');
    check('/career-hub.js itself still serves as JS', chJs.status === 200 && chJs.headers['content-type'].includes('javascript'));
    // A stale ?v= from a previous deploy must still resolve — the file behind the URL doesn't change per-query.
    const staleV = await req('GET', '/theme.css?v=some-old-stale-version');
    check('an old/unknown ?v= on the asset URL still serves the file (query string is cosmetic for cache-busting, not a real param)', staleV.status === 200);

    // ── nothing else regressed: redirects, 404s, API routes, dynamic routes ──
    const appRedirect = await req('GET', '/app');
    check('/app -> /dashboard redirect still wins over the static file', appRedirect.status === 301 && appRedirect.headers.location === '/dashboard');
    const tealRedirect = await req('GET', '/teal-alternative');
    check('/teal-alternative legacy redirect still wins', tealRedirect.status === 301);
    const dotHtmlRedirect = await req('GET', '/score.html');
    check('literal .html URLs still 301 to the canonical clean URL (pre-existing behavior, unchanged)', dotHtmlRedirect.status === 301);
    const missing = await req('GET', '/this-definitely-does-not-exist-xyz');
    check('an unknown path still 404s (branded 404 page, not swallowed)', missing.status === 404);
    const health = await req('GET', '/api/health');
    check('API routes are unaffected by the new HTML catch-all', health.status === 200 && JSON.parse(health.body).status === 'ok');
    const site404 = await req('GET', '/site/this-subdomain-does-not-exist-xyz');
    check('a dynamic personal-site route for an unknown subdomain still 404s through its own handler, not the HTML catch-all', site404.status === 404);
    const rolePage = await req('GET', '/software-engineer-resume');
    check('extensionless static role pages still resolve via the fallback', rolePage.status === 200 && /href="\/theme\.css\?v=/.test(rolePage.body));

  } catch (err) {
    failures++;
    console.error('FATAL', err);
  } finally {
    server.close();
    if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
    console.log('\nALL PASS (0 failures)');
    process.exit(0);
  }
});
