#!/usr/bin/env node
/**
 * PUBLISH SUCCESS — the success page, the "back to editor" round-trip, and
 * the confirmation email. Three separate reported/requested gaps, one file:
 *
 *   1. wcPublish() used to write its whole result — success, failure,
 *      "pick an address first" — into #wcPublishStatus, which lives inside
 *      the Content rail tab and is display:none unless that one tab is
 *      open. Clicking Publish from any other tab (the common case — you
 *      land on Templates) looked like it did nothing. Fixed with a toast
 *      (test/site-publish.js already covers that) AND now a real
 *      redirect to a durable success page with the link on it.
 *   2. The publish confirmation email — Resend, via the SAME sendEmail()
 *      helper every other transactional email in this codebase already
 *      uses (password reset, owner alerts) rather than a new SDK/client.
 *      Fires on a real, explicit publish only — never on autosave, which
 *      omits `publish` to preserve whatever the site already was.
 *
 * Usage: node test/publish-success.js
 */
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-pubok-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
const Database = require('better-sqlite3');

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('m@x.com', 'm', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokM', 'm@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('m@x.com', 'cM');
db.prepare("INSERT INTO employer_subscribers (email,customer_id,tier,status) VALUES (?,?,'corporate','active')").run('m@x.com', 'ecM');

let fails = 0;
const check = (n, c, d) => { if (c) console.log('PASS  ' + n); else { fails++; console.error('FAIL  ' + n + (d ? ' — ' + d : '')); } };

const RESUME = 'Marvin Person Jr\nmarvin@example.com | Detroit, MI\n\nSUMMARY\nOperations leader.\n\nEXPERIENCE\nPlant Manager, Ford\n- Cut downtime 22%\n\nSKILLS\nLean, Six Sigma';

const server = app.listen(0, async () => {
  const B = `http://127.0.0.1:${server.address().port}`;
  const HJ = { Authorization: 'Bearer tokM', 'Content-Type': 'application/json' };

  // ── The success page itself ────────────────────────────────────────────
  const successHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'publish-success.html'), 'utf8');
  check('the success page exists and reads the url from the query string',
    /params\.get\('url'\)/.test(successHtml));
  check('it offers Copy Link, Open Site and Back to Editor',
    /Copy Link/.test(successHtml) && />Open Site/.test(successHtml) && /Back to Editor/.test(successHtml));
  check('Back to Editor reopens the SAME site that was just published, not just /app.html blind',
    /backBtn\.href = '\/app\.html\?openWebsite=' \+ encodeURIComponent\(site\)/.test(successHtml));
  check('an empty url does not pretend to have one — no fake link, no dead copy button',
    /if \(url\) \{[\s\S]*?\} else \{[\s\S]*?display = 'none'/.test(successHtml));

  // ── app.html: the redirect, and reopening a site by address ───────────
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
  check('a successful publish redirects to the success page with the real url and site',
    /window\.location\.href = '\/publish-success\.html\?url=' \+ encodeURIComponent\(data\.url\)/.test(appJs)
    && /encodeURIComponent\(data\.subdomain\)/.test(appJs));
  check('the toast still fires before the redirect — kept as backup feedback, not replaced',
    /setStatus\('🌐 ' \+ _t\('wc_live_at'[\s\S]{0,600}setTimeout\(\(\) => \{[\s\S]{0,200}publish-success\.html/.test(appJs));
  check('?openWebsite=<sub> on load reopens that exact site the way the Back Office\'s Edit does',
    /const openSub = new URLSearchParams\(window\.location\.search\)\.get\('openWebsite'\)/.test(appJs)
    && /wcOpenSub = openSub; showTab\('website'\)/.test(appJs));

  // ── The email: real template, real substitution, fires on a real publish ──
  const emailTplPath = path.join(__dirname, '..', 'emails', 'publish-success.html');
  check('the email template file exists', fs.existsSync(emailTplPath));
  const emailTpl = fs.readFileSync(emailTplPath, 'utf8');
  check('it has the pieces the spec asked for — headline, URL display, CTA, footer',
    /Congratulations.*Your website is live/.test(emailTpl)
    && /\{\{SITE_URL\}\}/.test(emailTpl) && /View Your Site/.test(emailTpl)
    && /LinkedIn/.test(emailTpl) && /unsubscribe/i.test(emailTpl));
  check('no logo IMAGE that would 404 in an inbox — CSS lockup instead, like the reset-password email',
    !/<img[^>]*logo/i.test(emailTpl));

  // Publishing for real triggers the email — captured via a monkey-patched
  // fetch, the same layer sendEmail() itself calls, rather than trusting a
  // console log.
  const realFetch = global.fetch;
  const sent = [];
  process.env.RESEND_API_KEY = 'test_key';
  process.env.OWNER_ALERTS = 'off'; // isolate: only the publish email, not an owner alert too
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('api.resend.com')) {
      sent.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ id: 'test' }) };
    }
    return realFetch(url, opts);
  };

  try {
    const pub = await fetch(B + '/api/personal-site', {
      method: 'POST', headers: HJ,
      body: JSON.stringify({ subdomain: 'marvin-p', text: RESUME, name: 'Marvin', config: { v: 2, pages: [] }, publish: true }),
    });
    const pubBody = await pub.json();
    check('the publish itself succeeds', pub.status === 200 && pubBody.published === true, JSON.stringify(pubBody));

    await new Promise((r) => setTimeout(r, 150)); // fire-and-forget
    check('a real, explicit publish sends exactly one email', sent.length === 1, 'sent=' + sent.length);
    const mail = sent[0];
    check('to the signed-in user, not the owner', mail && mail.to === 'm@x.com', JSON.stringify(mail && mail.to));
    check('with the exact subject the spec asked for',
      mail && mail.subject === '🌐 Your ResumeTailored website is now live!', JSON.stringify(mail && mail.subject));
    check('the real published URL is substituted into the template, not left as a token',
      mail && mail.html.includes(pubBody.url) && !mail.html.includes('{{SITE_URL}}'), 'missing url or leftover token');

    // ── Autosave (publish omitted) must NOT send an email. ────────────────
    sent.length = 0;
    const auto = await fetch(B + '/api/personal-site', {
      method: 'POST', headers: HJ,
      body: JSON.stringify({ subdomain: 'marvin-p', text: RESUME, name: 'Marvin', config: { v: 2, pages: [] } }),
    });
    check('autosave (no publish flag) still succeeds', auto.status === 200);
    await new Promise((r) => setTimeout(r, 150));
    check('but autosave sends no email — only an explicit publish does', sent.length === 0, 'sent=' + sent.length);

    // ── Unpublishing must NOT send a "your site is live" email either. ────
    sent.length = 0;
    const unpub = await fetch(B + '/api/personal-site', {
      method: 'POST', headers: HJ,
      body: JSON.stringify({ subdomain: 'marvin-p', text: RESUME, name: 'Marvin', config: { v: 2, pages: [] }, publish: false }),
    });
    check('an explicit unpublish still succeeds', unpub.status === 200);
    await new Promise((r) => setTimeout(r, 150));
    check('and does not send a "you\'re live" email', sent.length === 0, 'sent=' + sent.length);
  } finally {
    global.fetch = realFetch;
  }

  server.close();
  if (fails) { console.error(`\nFAILED (${fails} failure${fails === 1 ? '' : 's'})`); process.exit(1); }
  console.log('\nALL PASS (0 failures)');
  process.exit(0);
});
