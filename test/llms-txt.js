#!/usr/bin/env node
/**
 * LLMS.TXT — the platform-wide index and the per-site, auto-generated one.
 *
 * Covers three layers:
 *   1. generateLlmsTxt() itself — the pure builder in llms-txt.js.
 *   2. public/llms.txt — the hand-authored platform index (format + no stale
 *      pre-2026-pricing-change numbers left behind).
 *   3. The per-site route. Personal sites here have no static deploy
 *      directory — every page is rendered fresh from the `personal_sites` row
 *      on each request (see _renderPersonalSite/_serveSite in server.js) —
 *      so llms.txt follows the same pattern: generated on every request to
 *      /site/:sub/llms.txt (and the host-based equivalent) rather than
 *      written to disk at publish time.
 *
 * Usage: node test/llms-txt.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── 1. The pure builder ───────────────────────────────────────────────────
const { generateLlmsTxt } = require('../llms-txt.js');

const basic = generateLlmsTxt({
  name: 'Alice Nakamura',
  tagline: 'Staff engineer with 10 years building distributed systems.',
  pages: [
    { title: 'Alice Nakamura', url: 'https://alice.resumetailored.com', description: 'Home and resume.' },
    { title: 'Work', url: 'https://alice.resumetailored.com/work', description: 'Selected projects.' },
  ],
});
check('starts with an H1 of the site name', basic.startsWith('# Alice Nakamura\n'));
check('has a blockquote description', /\n> Staff engineer with 10 years/.test(basic));
check('lists pages under an H2, each as an annotated link',
  /## Pages\n- \[Alice Nakamura\]\(https:\/\/alice\.resumetailored\.com\): Home and resume\.\n- \[Work\]\(https:\/\/alice\.resumetailored\.com\/work\): Selected projects\./.test(basic));
check('ends with a trailing newline', basic.endsWith('\n') && !basic.endsWith('\n\n'));

const noPages = generateLlmsTxt({ name: 'Bob' });
check('with no pages, still produces a valid H1 + blockquote, no dangling H2',
  noPages === '# Bob\n\n> The personal website of Bob.\n');

const noDesc = generateLlmsTxt({ name: 'X', pages: [{ title: 'Home', url: 'https://x.example' }] });
check('a page with no description renders as a plain link, not "undefined"',
  noDesc.includes('- [Home](https://x.example)\n') && !noDesc.includes('undefined'));

const badPage = generateLlmsTxt({ name: 'X', pages: [{ title: 'No URL' }, { title: 'Has URL', url: 'https://x.example' }] });
check('a page missing a url is dropped rather than emitting a broken link',
  !badPage.includes('No URL') && badPage.includes('Has URL'));

// ── 2. The platform llms.txt ──────────────────────────────────────────────
const platform = fs.readFileSync(path.join(__dirname, '..', 'public', 'llms.txt'), 'utf8');
check('starts with a last-updated comment', /^<!--\s*Last updated:\s*\d{4}-\d{2}-\d{2}/.test(platform));
check('has an H1 naming the product', /^# ResumeTailored/m.test(platform));
check('has a blockquote description', /\n> ResumeTailored/.test(platform));
check('groups links under H2 sections', (platform.match(/^## /gm) || []).length >= 3);
check('every link line is annotated with a description, not a bare link',
  (platform.match(/^- \[[^\]]+\]\([^)]+\)$/gm) || []).length === 0);
check('does not advertise the pre-2026 capped free tier',
  !/1 (full )?(resume )?tailoring.{0,20}(per day|\/day)/i.test(platform));
check('reflects the current $19.99 Pro price, not the old $19',
  platform.includes('$19.99') && !/\$19\/month|\$19\/mo\b/.test(platform));
check('reflects the $129 lifetime plan', platform.includes('$129'));

// ── 3. robots.txt references it ───────────────────────────────────────────
const robotsPath = path.join(__dirname, '..', 'public', 'robots.txt');
if (fs.existsSync(robotsPath)) {
  const robots = fs.readFileSync(robotsPath, 'utf8');
  check('robots.txt points at the platform llms.txt',
    /Sitemap:\s*https:\/\/resumetailored\.com\/llms\.txt/.test(robots));
}

// ── 4. The per-site route ─────────────────────────────────────────────────
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-llms-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
process.env.SITE_PUBLIC_HOST = 'resumetailored.com';
const { app } = require('../server.js');
const Database = require('better-sqlite3');
const http = require('http');

const getWithHost = (port, urlPath, hostHeader) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET', headers: { Host: hostHeader } }, (res) => {
    let body = ''; res.setEncoding('utf8');
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  req.on('error', reject);
  req.end();
});

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('a@x.com', 'alice', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokA', 'a@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('a@x.com', 'cA');
db.prepare("INSERT INTO employer_subscribers (email,customer_id,tier,status) VALUES (?,?,'corporate','active')").run('a@x.com', 'ecA');

const RESUME = 'Alice Nakamura\nalice@example.com | Seattle\n\nSUMMARY\nStaff engineer with 10 years building distributed systems.\n\nEXPERIENCE\nStaff Engineer, Northwind\n- Cut p99 latency by 40%\n\nSKILLS\nGo, Postgres';

const CONFIG = {
  v: 2,
  templateId: 'minimal',
  pages: [
    { id: 'home', name: 'Home', slug: 'home', isHome: true, sections: [],
      seo: { title: 'Alice Nakamura — Staff Engineer', description: 'Portfolio and resume of a Seattle-based staff engineer.' } },
    { id: 'work', name: 'Work', slug: 'work', sections: [] },
  ],
  assets: { coverLetterText: 'Dear Hiring Manager,\n\nI am excited to apply.\n\nSincerely,\nAlice'.repeat(2) },
};

const server = app.listen(0, async () => {
  const port = server.address().port;
  const B = `http://127.0.0.1:${port}`;
  const AJ = { Authorization: 'Bearer tokA', 'Content-Type': 'application/json' };

  try {
    // A draft (never published) must not leak its llms.txt any more than it
    // leaks the page itself.
    await fetch(`${B}/api/personal-site`, {
      method: 'POST', headers: AJ,
      body: JSON.stringify({ subdomain: 'alice', text: RESUME, name: 'Alice Nakamura', config: CONFIG, publish: false }),
    });
    const draftTxt = await fetch(`${B}/site/alice/llms.txt`);
    check('a draft site\'s llms.txt is not publicly reachable', draftTxt.status === 404);

    // Publish, then fetch it for real.
    const pub = await fetch(`${B}/api/personal-site`, {
      method: 'POST', headers: AJ,
      body: JSON.stringify({ subdomain: 'alice', text: RESUME, name: 'Alice Nakamura', config: CONFIG, publish: true }),
    });
    check('publishing succeeds', pub.status === 200 && (await pub.json()).published === true);

    const txt = await fetch(`${B}/site/alice/llms.txt`);
    const body = await txt.text();
    check('a published site serves llms.txt at its root', txt.status === 200, 'status=' + txt.status);
    check('served as plain text', (txt.headers.get('content-type') || '').includes('text/plain'));
    check('the H1 is the person\'s name', body.startsWith('# Alice Nakamura\n'));
    check('the blockquote uses the page\'s own SEO description', body.includes('> Portfolio and resume of a Seattle-based staff engineer.'));
    check('the home page is linked at the site root, not at its own slug (/home)',
      /\]\(https?:\/\/[^)]*\/site\/alice\): /.test(body), body);
    check('the home link uses its own SEO title', body.includes('[Alice Nakamura — Staff Engineer]'));
    check('the second page is linked at its slug', /\/work\)/.test(body));
    check('a page with no explicit SEO description still gets one, not a blank',
      /\[Work\]\([^)]+\): A page on Alice Nakamura's site\./.test(body));
    check('the cover letter is offered as its own linked page',
      /\[Alice Nakamura — Cover Letter\]\([^)]*\/site\/alice\/cover-letter\)/.test(body));
    check('the cover letter link actually resolves',
      (await fetch(`${B}/site/alice/cover-letter`)).status === 200);

    // Never through sitePublicUrl's pageSlug sanitizer, which would turn
    // "llms.txt" into "llmstxt" — a regression this pins directly.
    check('the filename itself is never mangled by slug sanitization', !body.includes('llmstxt'));

    // ── A site with no cover letter and no multi-page config ──────────────
    db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('b@x.com', 'bob', 'x');
    db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokB', 'b@x.com');
    db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('b@x.com', 'cB');
    db.prepare("INSERT INTO employer_subscribers (email,customer_id,tier,status) VALUES (?,?,'corporate','active')").run('b@x.com', 'ecB');
    await fetch(`${B}/api/personal-site`, {
      method: 'POST', headers: { Authorization: 'Bearer tokB', 'Content-Type': 'application/json' },
      body: JSON.stringify({ subdomain: 'bob', text: RESUME.replace('Alice Nakamura', 'Bob Reyes').replace('alice@example.com', 'bob@example.com'), name: 'Bob Reyes', publish: true }),
    });
    const bobTxt = await (await fetch(`${B}/site/bob/llms.txt`)).text();
    check('a legacy/simple site with no config still gets a valid one-page llms.txt',
      bobTxt.startsWith('# Bob Reyes\n') && bobTxt.includes('## Pages'));
    check('no cover letter link when there is no cover letter', !bobTxt.includes('Cover Letter'));

    // ── Host-based subdomain ────────────────────────────────────────────────
    const hostTxt = await getWithHost(port, '/llms.txt', 'alice.resumetailored.com');
    check('the host-based subdomain also serves llms.txt', hostTxt.status === 200);
    check('with the same H1 and blockquote as the path-based version',
      hostTxt.body.startsWith('# Alice Nakamura\n\n> Portfolio and resume of a Seattle-based staff engineer.'));
    check('home page linked at the bare subdomain root, not a /site/ path',
      // The cover letter link below legitimately still uses /site/alice/... (see
      // the next check) — this only asserts the HOME link's own line is bare.
      /\]\(https:\/\/alice\.resumetailored\.com\): /.test(hostTxt.body), hostTxt.body);
    check('the second page linked at its own path on the subdomain',
      /\]\(https?:\/\/alice\.resumetailored\.com\/work\): /.test(hostTxt.body));
    check('the cover letter link still uses the working /site/:sub form even on the subdomain host',
      /\]\(https?:\/\/alice\.resumetailored\.com\/site\/alice\/cover-letter\)/.test(hostTxt.body), hostTxt.body);

    // ── Renamed / unknown addresses ──────────────────────────────────────────
    const renamed = await fetch(`${B}/api/personal-site`, {
      method: 'POST', headers: AJ,
      body: JSON.stringify({ subdomain: 'a-nakamura', renameFrom: 'alice', text: RESUME, name: 'Alice Nakamura', config: CONFIG, publish: true }),
    });
    check('the rename succeeds', renamed.status === 200);
    const oldAddr = await fetch(`${B}/site/alice/llms.txt`, { redirect: 'manual' });
    check('the old address 301s to the new one\'s llms.txt rather than 404ing',
      oldAddr.status === 301 && /a-nakamura\/llms\.txt$/.test(oldAddr.headers.get('location') || ''),
      oldAddr.headers.get('location'));
    check('an unknown site 404s rather than crashing', (await fetch(`${B}/site/nobody/llms.txt`)).status === 404);
  } finally {
    server.close();
    if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
    console.log('\nALL PASS (0 failures)');
    process.exit(0);
  }
});
