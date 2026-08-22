#!/usr/bin/env node
/** End-to-end signup -> welcome message -> unsubscribe regression test. */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-welcome-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
process.env.RESEND_API_KEY = 'test_resend_key';
process.env.EMAIL_FROM = 'support@resumetailored.com';
process.env.EMAIL_FROM_NAME = 'ResumeTailored AI';
process.env.OWNER_ALERTS = 'off';

const realFetch = global.fetch;
const sent = [];
global.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.includes('api.resend.com')) {
    sent.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ id: 'email_test_1' }) };
  }
  // Signup checks the HIBP range endpoint. An empty result means the unique
  // fixture password is not present; no external network is used by this test.
  if (target.includes('api.pwnedpasswords.com')) {
    return { ok: true, status: 200, text: async () => '' };
  }
  return realFetch(url, options);
};

const { app } = require('../server.js');
const Database = require('better-sqlite3');
let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log('PASS  ' + name);
  else { failures++; console.error('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.PUBLIC_APP_URL = base;
  try {
    const signup = await realFetch(base + '/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'welcome-test@example.com',
        username: 'Mobile <Tester>',
        password: 'F8!kR2@wQ9#zT4$p'
      })
    });
    check('signup succeeds and creates an authenticated account', signup.status === 200, await signup.text());
    await new Promise(resolve => setTimeout(resolve, 100));

    check('signup sends exactly one welcome email through Resend', sent.length === 1, `sent=${sent.length}`);
    const mail = sent[0] || {};
    check('sender name and verified-domain address are explicit', mail.from === 'ResumeTailored AI <support@resumetailored.com>', mail.from);
    check('welcome message goes to the new account', mail.to === 'welcome-test@example.com', mail.to);
    check('mobile-safe template has a viewport and responsive rule', /name="viewport"/.test(mail.html || '') && /max-width:620px/.test(mail.html || ''));
    check('template uses email-safe tables and no flex/grid/gradient layout', /role="presentation"/.test(mail.html || '') && !/display:(?:flex|grid)|linear-gradient/i.test(mail.html || ''));
    check('user-controlled name is HTML-escaped', /Mobile &lt;Tester&gt;/.test(mail.html || '') && !/Mobile <Tester>/.test(mail.html || ''));
    check('visible unsubscribe link is included', /Unsubscribe from product emails/.test(mail.html || '') && /\/unsubscribe\?token=/.test(mail.html || ''));
    check('RFC 8058 unsubscribe headers are included', !!(mail.headers && /^<http:\/\/127\.0\.0\.1:\d+\/unsubscribe\?token=/.test(mail.headers['List-Unsubscribe']) && mail.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click'));

    const match = String(mail.headers && mail.headers['List-Unsubscribe']).match(/^<(.+)>$/);
    const unsubscribeUrl = match && match[1];
    const confirm = unsubscribeUrl && await realFetch(unsubscribeUrl);
    check('unsubscribe link opens a confirmation page without opting out on GET', confirm && confirm.status === 200 && /Email preferences/.test(await confirm.text()));

    const token = unsubscribeUrl && new URL(unsubscribeUrl).searchParams.get('token');
    const unsubscribe = unsubscribeUrl && await realFetch(unsubscribeUrl, { method: 'POST' });
    check('mail-provider one-click POST to the header URL succeeds', unsubscribe && unsubscribe.status === 200 && /preferences updated/i.test(await unsubscribe.text()));

    const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'), { readonly: true });
    const pref = db.prepare('SELECT product_emails_enabled FROM email_preferences WHERE email = ?').get('welcome-test@example.com');
    check('unsubscribe preference is persisted', pref && pref.product_emails_enabled === 0);
    db.close();
  } catch (error) {
    failures++;
    console.error('FAIL  unexpected test error — ' + error.stack);
  } finally {
    global.fetch = realFetch;
    server.close();
  }

  if (failures) {
    console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`);
    process.exit(1);
  }
  console.log('\nALL PASS (0 failures)');
  process.exit(0);
});
