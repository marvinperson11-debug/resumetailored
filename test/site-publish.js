#!/usr/bin/env node
/**
 * PERSONAL SITE — draft state, public URL, and subdomain routing.
 *
 * Three things this locks down:
 *
 * 1. DRAFTS. `POST /api/personal-site` used to force `published = 1` on every
 *    save, so there was no way to create a site without it being publicly
 *    reachable. The auto-generated starter site is built from the user's resume
 *    — their name, employers and contact details — so it must be able to exist
 *    privately until they press Publish.
 *
 * 2. THE PUBLIC URL. The client used to build `<origin>/site/<name>` by hand in
 *    nine places, which is why nothing could follow a move to subdomains. The
 *    server is now the only thing that decides, driven by SITE_PUBLIC_HOST.
 *
 * 3. SUBDOMAIN ROUTING. The host middleware only handled `/`, so a multi-page
 *    site's nav links broke out of the subdomain.
 *
 * Usage: node test/site-publish.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-pub-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
process.env.SITE_PUBLIC_HOST = 'resumetailored.com'; // read at module load
const { app } = require('../server.js');
const Database = require('better-sqlite3');
const http = require('http');

// fetch() refuses to set a Host header (it is a forbidden header name), so the
// subdomain routing has to be exercised with a raw request.
const getWithHost = (port, urlPath, hostHeader, extra) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET',
    headers: Object.assign({ Host: hostHeader }, extra || {}) }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', reject);
  req.end();
});

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
const mkUser = (email, token, username) => {
  db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run(email, username, 'x');
  db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run(token, email);
  db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run(email, 'c_' + username);
};
mkUser('a@x.com', 'tokA', 'alice');
mkUser('b@x.com', 'tokB', 'bob');

const RESUME = 'Alice Nakamura\nalice@example.com | Seattle\n\nSUMMARY\nStaff engineer with 10 years.\n\nEXPERIENCE\nStaff Engineer, Northwind\n• Cut p99 latency by 40%\n\nSKILLS\nGo, Postgres';

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const server = app.listen(0, async () => {
  const port = server.address().port;
  const B = `http://127.0.0.1:${port}`;
  const AJ = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });

  try {
    // ── Auto-generate with nothing to build from ────────────────────────────
    const noR = await fetch(`${B}/api/personal-site/autogen`, { method: 'POST', headers: AJ('tokA') });
    check('autogen without a saved resume is refused, with a reason',
      noR.status === 409 && (await noR.json()).error === 'no_resume');

    // ── Auto-generate from the most recent saved resume ─────────────────────
    db.prepare('INSERT INTO saved_resumes (email,title,content,created_at) VALUES (?,?,?,?)')
      .run('a@x.com', 'Northwind application', RESUME, Date.now());
    const genRes = await fetch(`${B}/api/personal-site/autogen`, { method: 'POST', headers: AJ('tokA') });
    const gen = await genRes.json();
    check('autogen creates a site', genRes.status === 200 && gen.created === true);
    check('autogen picks an address from the username', gen.subdomain === 'alice', gen.subdomain);
    check('autogen takes the name from the resume', gen.name === 'Alice Nakamura', gen.name);
    check('autogen returns a full site document',
      gen.config && Array.isArray(gen.config.pages) && gen.config.pages.length > 0);
    check('autogen puts the real name in the page', JSON.stringify(gen.config).includes('Alice Nakamura'));
    check('autogen links the resume it was built from',
      !!(gen.config.assets && gen.config.assets.resumeId));

    // The starter template ships with sample prose ("Marketing Manager ·
    // Toronto" and an invented biography). Leaving it in place would hand the
    // user a page making false claims about them, on a URL they are about to
    // send to recruiters.
    const genJson = JSON.stringify(gen.config);
    check('sample role/location is replaced with the real one',
      genJson.includes('Staff Engineer · Seattle') && !genJson.includes('Marketing Manager'));
    check('sample biography is replaced with the real summary',
      genJson.includes('Staff engineer with 10 years') && !genJson.includes('turning research into campaigns'));
    check('no template sample prose survives anywhere',
      !/Jordan Ellis|Alex Morgan|Toronto/.test(genJson));

    // THE POINT: it exists, but it is not public.
    check('autogen result is a draft', gen.published === false);
    check('a draft is NOT publicly reachable', (await fetch(`${B}/site/alice`)).status === 404);

    // ── Never overwrites ────────────────────────────────────────────────────
    const again = await (await fetch(`${B}/api/personal-site/autogen`, { method: 'POST', headers: AJ('tokA') })).json();
    check('autogen never overwrites an existing site', again.created === false && again.subdomain === 'alice');

    // ── Address collision ───────────────────────────────────────────────────
    db.prepare('INSERT INTO saved_resumes (email,title,content,created_at) VALUES (?,?,?,?)')
      .run('b@x.com', 'r', RESUME.replace('Alice Nakamura', 'Bob Reyes'), Date.now());
    db.prepare("UPDATE users SET username = 'alice' WHERE email = 'b@x.com'").run(); // force a clash
    const bob = await (await fetch(`${B}/api/personal-site/autogen`, { method: 'POST', headers: AJ('tokB') })).json();
    check('a taken address is numbered rather than failing', bob.subdomain === 'alice-2', bob.subdomain);

    // ── Publishing ──────────────────────────────────────────────────────────
    // Explicit, always. This is the one call that makes a site public, and it
    // corresponds to the user pressing one green button.
    const pub = await fetch(`${B}/api/personal-site`, {
      method: 'POST', headers: AJ('tokA'),
      body: JSON.stringify({ subdomain: 'alice', text: RESUME, name: 'Alice Nakamura', config: gen.config, publish: true }),
    });
    check('publishing succeeds', pub.status === 200 && (await pub.json()).published === true);
    check('a published site IS publicly reachable', (await fetch(`${B}/site/alice`)).status === 200);

    // ── Explicit draft save ─────────────────────────────────────────────────
    const draft = await fetch(`${B}/api/personal-site`, {
      method: 'POST', headers: AJ('tokA'),
      body: JSON.stringify({ subdomain: 'alice', text: RESUME, name: 'Alice Nakamura', config: gen.config, publish: false }),
    });
    check('publish:false saves without going live', draft.status === 200 && (await draft.json()).published === false);
    check('unpublishing actually takes the page down', (await fetch(`${B}/site/alice`)).status === 404);

    // ── Omission preserves. THE guarantee behind "private until you publish" ──
    // Auto-save sends no `publish` flag. If omission meant "publish", every
    // keystroke on a private draft would expose it; if it meant "unpublish",
    // editing a live site would silently take it down. Neither may happen.
    const autosave = (extra) => fetch(`${B}/api/personal-site`, {
      method: 'POST', headers: AJ('tokA'),
      body: JSON.stringify(Object.assign({
        subdomain: 'alice', text: RESUME, name: 'Alice Nakamura', config: gen.config,
      }, extra || {})),
    });

    // Currently a draft (unpublished just above).
    const a1 = await (await autosave()).json();
    check('auto-save on a draft leaves it private', a1.published === false);
    check('the draft is still not reachable', (await fetch(`${B}/site/alice`)).status === 404);

    // Explicitly publish, then auto-save again.
    await autosave({ publish: true });
    const a2 = await (await autosave()).json();
    check('auto-save on a live site keeps it live', a2.published === true);
    check('the live site stays reachable', (await fetch(`${B}/site/alice`)).status === 200);

    // And going private is equally explicit.
    const a3 = await (await autosave({ publish: false })).json();
    check('unpublishing requires an explicit flag', a3.published === false);
    await autosave({ publish: true }); // restore for the subdomain checks below

    // ── Cover letter: a download, never printed on the page ──────────────────
    // A cover letter is addressed to one company. Rendered inline, every other
    // recruiter reads a letter written to someone else.
    const LETTER = 'Dear Hiring Manager,\n\nI am writing about the Staff Engineer role at Northwind.\n\nSincerely,\nAlice';
    const CLDOC = JSON.parse(JSON.stringify(gen.config));
    CLDOC.assets = Object.assign({}, CLDOC.assets, { coverLetterId: 7, coverLetterText: LETTER });
    CLDOC.pages[0].sections[0].els.push({
      id: 'cl1', type: 'coverletter', x: 80, y: 400, w: 300, h: 50, props: { text: 'Read my cover letter' },
    });

    // While it is still a draft, nothing about it may be reachable.
    await autosave({ config: CLDOC, publish: false });
    check('a draft does not leak the cover letter', (await fetch(`${B}/site/alice/cover-letter`)).status === 404);

    await autosave({ config: CLDOC, publish: true });
    const clPage = await (await fetch(`${B}/site/alice`)).text();
    check('the page offers the cover letter as a download',
      clPage.includes('/site/alice/cover-letter') && clPage.includes('Read my cover letter'));
    check('the letter itself is NOT printed on the page', !clPage.includes('Dear Hiring Manager'));

    const dl = await fetch(`${B}/site/alice/cover-letter`);
    const dlText = await dl.text();
    check('the download serves the letter', dl.status === 200 && dlText.includes('Dear Hiring Manager'));
    check('the download is an attachment, not a page',
      (dl.headers.get('content-disposition') || '').includes('attachment'));

    // With no cover letter chosen, the button must not render a dead link.
    const NOCL = JSON.parse(JSON.stringify(CLDOC));
    NOCL.assets.coverLetterText = '';
    await autosave({ config: NOCL, publish: true });
    const noClPage = await (await fetch(`${B}/site/alice`)).text();
    check('no cover letter → no download button', !noClPage.includes('/site/alice/cover-letter'));
    check('no cover letter → the download 404s', (await fetch(`${B}/site/alice/cover-letter`)).status === 404);

    await autosave({ config: gen.config, publish: true }); // restore for later checks

    // ── The server owns the public URL ──────────────────────────────────────
    const me = await (await fetch(`${B}/api/personal-site`, { headers: AJ('tokA') })).json();
    // https everywhere except localhost, where the scheme stays http so the
    // host mode can be exercised locally without a certificate.
    check('the site URL comes from the server, in subdomain form',
      me.url === 'http://alice.resumetailored.com', me.url);

    // ── Subdomain routing, including pages ──────────────────────────────────
    const MULTI = JSON.parse(JSON.stringify(gen.config));
    MULTI.pages.push({
      id: 'work', name: 'Work', slug: 'work',
      sections: [{
        id: 's1', h: 300, bg: { type: 'color', value: '#ffffff' },
        els: [
          { id: 'w-nav', type: 'nav', x: 80, y: 30, w: 900, h: 40, props: {} },
          { id: 'w-h', type: 'heading', x: 80, y: 100, w: 700, h: 90, props: { text: 'Selected work' } },
        ],
      }],
    });
    await fetch(`${B}/api/personal-site`, {
      method: 'POST', headers: AJ('tokA'),
      body: JSON.stringify({ subdomain: 'alice', text: RESUME, name: 'Alice Nakamura', config: MULTI }),
    });
    const HOST = 'alice.resumetailored.com';
    const root = await getWithHost(port, '/', HOST);
    check('the subdomain host serves the site at /', root.status === 200 && root.body.includes('Alice Nakamura'));
    check('nav links stay on the subdomain — no /site/ path',
      root.body.includes(`http://${HOST}/work`) && !root.body.includes('/site/alice'), 
      root.body.includes('/site/alice') ? 'still emitting /site/ links' : 'no subdomain nav link found');
    check('the canonical URL is the subdomain', root.body.includes(`rel="canonical" href="http://${HOST}/`));

    const page = await getWithHost(port, '/work', HOST);
    check('the subdomain host serves a second page', page.status === 200 && page.body.includes('Selected work'));

    // A path that is not a page of this site must fall through to the normal
    // routes rather than 404 on a guess.
    const apiOnHost = await getWithHost(port, '/api/personal-site', HOST, { Authorization: 'Bearer tokA' });
    check('a non-page path on the subdomain falls through to the app', apiOnHost.status === 200);
    const assetOnHost = await getWithHost(port, '/style.css', HOST);
    check('static assets still serve on the subdomain', assetOnHost.status === 200);

    // Reserved hosts and the apex must be untouched by all of this.
    check('the apex domain is unaffected', (await getWithHost(port, '/', 'resumetailored.com')).status === 200);
    check('www is unaffected', (await getWithHost(port, '/', 'www.resumetailored.com')).status === 200);
    check('an unknown subdomain 404s', (await getWithHost(port, '/', 'nobody.resumetailored.com')).status === 404);

    // ── Gating ──────────────────────────────────────────────────────────────
    db.prepare("DELETE FROM subscribers WHERE email = 'a@x.com'").run();
    check('autogen is Pro-gated',
      (await fetch(`${B}/api/personal-site/autogen`, { method: 'POST', headers: AJ('tokA') })).status === 402);
    check('autogen requires sign-in',
      (await fetch(`${B}/api/personal-site/autogen`, { method: 'POST' })).status === 401);
  } catch (e) {
    failures++;
    console.error('FAIL  unexpected error —', e && e.stack);
  }

  console.log(`\n${failures ? 'FAILED' : 'ALL PASS'} (${failures} failure${failures === 1 ? '' : 's'})`);
  server.close();
  db.close();
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  process.exit(failures ? 1 : 0);
});
