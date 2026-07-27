#!/usr/bin/env node
/**
 * WEBSITE EDITOR — end-to-end, in a real browser, at two widths.
 *
 * Deliberately NOT under `test/*.js`: the suite there is dependency-free and
 * runs in a loop, and this needs Chromium. Run it by hand:
 *
 *     npm i --no-save playwright-core
 *     node test/browser/editor.js
 *
 * Why it exists. Every editor bug in this feature's history was invisible to a
 * source-level test, because each one was true of a variable and false of the
 * screen: `edDevice` changed while the highlight did not; a button held
 * `hidden = true` while a class kept it visible; the inspector rendered its
 * controls into a panel that CSS had removed at phone width. So this measures
 * rendered geometry, DOM presence and actual network traffic — never internal
 * state — and it runs at 1440px AND 390px, because two of those bugs existed
 * only on the phone.
 *
 * The path it walks: gallery → Use → editor → select → edit → autosave → Done.
 */
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-br-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../../server.js');
const Database = require('better-sqlite3');
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch (_) {
  console.log('SKIP  playwright-core is not installed — `npm i --no-save playwright-core` to run this.');
  process.exit(0);
}

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('a@x.com', 'alice', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokA', 'a@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('a@x.com', 'c_a');
const RESUME = 'Alice Nakamura\nalice@example.com | Seattle\n\nSUMMARY\nStaff engineer with 10 years.\n\nEXPERIENCE\nStaff Engineer, Northwind\n• Cut p99 latency by 40%\n\nSKILLS\nGo, Postgres';

let failures = 0;
const check = (n, c, d) => { if (c) console.log('PASS  ' + n); else { failures++; console.error('FAIL  ' + n + (d ? ' — ' + d : '')); } };

const server = app.listen(0, async () => {
  const port = server.address().port, B = `http://127.0.0.1:${port}`;
  const AJ = { Authorization: 'Bearer tokA', 'Content-Type': 'application/json' };
  await fetch(B + '/api/resumes', { method: 'POST', headers: AJ, body: JSON.stringify({ title: 'SWE Resume', content: RESUME }) });

  // playwright-core ships no browser. Point CHROME_PATH at one, or let it fall
  // back to a Playwright-managed Chromium if the full `playwright` is present.
  const exe = process.env.CHROME_PATH || null;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const errs = [], posts = [], net = [];
  try {
    for (const width of [1440, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      page.on('pageerror', e => errs.push(width + 'px: ' + e.message));
      page.on('requestfailed', r => net.push(width + 'px FAILED ' + r.url() + ' — ' + (r.failure() || {}).errorText));
      page.on('response', r => { if (r.status() >= 400) net.push(width + 'px ' + r.status() + ' ' + r.url()); });
      page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/personal-site')) posts.push({ width, url: r.url() }); });

      await page.addInitScript(() => {
        localStorage.setItem('rt_token', 'tokA');
        localStorage.setItem('rt_email', 'a@x.com');
        localStorage.setItem('rt_username', 'alice');
      });
      await page.goto(B + '/app.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.showTab === 'function');
      await page.evaluate(() => showTab('website'));
      await page.waitForSelector('.cv-tplgrid .wc-tpl-card, .cv-tplcard', { timeout: 15000 }).catch(() => {});

      console.log(`\n── ${width}px ─────────────────────────────`);

      // The deleted view must not exist in the DOM at all.
      const smGone = await page.evaluate(() => !document.getElementById('smView') && !document.querySelector('.sm-view, .sm-strip, .sm-help'));
      check(`${width}: no simple-mode node in the DOM`, smGone);

      // Gallery is the front door.
      const tiles = await page.locator('.cv-tplgrid button, .cv-tplgrid .wc-tpl-card').count();
      check(`${width}: template gallery is what you land on`, tiles > 0, 'tiles=' + tiles);

      // Use a template.
      const before = errs.length;
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => /^(Use|使用)$/.test(x.textContent.trim()));
        if (b) b.click();
      });
      await page.waitForFunction(() => !document.body.classList.contains('wb-picker'), { timeout: 20000 }).catch(() => {});
      const inEditor = await page.evaluate(() => ({
        picker: document.body.classList.contains('wb-picker'),
        canvas: !!document.querySelector('#wcEdStage .cv-canvasbox'),
        els: document.querySelectorAll('[data-el]').length,
        text: (document.getElementById('cvShell') || {}).innerText ? document.getElementById('cvShell').innerText.length : 0,
      }));
      check(`${width}: Use opens the editor`, !inEditor.picker && inEditor.canvas, JSON.stringify(inEditor));
      check(`${width}: the canvas is not blank`, inEditor.els > 0, 'elements=' + inEditor.els);
      check(`${width}: applying a template threw nothing`, errs.length === before, errs.slice(before).join(' | '));

      // Select an element and prove the inspector shows its controls.
      const sel = await page.evaluate(() => {
        const el = document.querySelector('[data-el]');
        if (!el) return null;
        edSelect(el.getAttribute('data-el'));
        const box = document.getElementById('wcEdInspector');
        return { id: edSel, hidden: box.hidden, visible: box.offsetWidth > 0, controls: box.querySelectorAll('input,select,textarea,button').length };
      });
      check(`${width}: selecting shows the inspector`, sel && !sel.hidden && sel.visible && sel.controls > 0, JSON.stringify(sel));

      // Edit through the store and prove autosave reaches the server.
      const nPosts = posts.length;
      await page.evaluate(() => {
        const first = document.querySelector('[data-el]').getAttribute('data-el');
        edApply(d => { const f = SiteDocStore.findElement(d, first); if (f) f.el.props.text = 'BROWSER CHECK ' + Date.now(); });
      });
      await page.waitForTimeout(2500);
      check(`${width}: an edit autosaves`, posts.length > nPosts, `posts before=${nPosts} after=${posts.length}`);

      // Done Editing lands in the Back Office, not a full-screen view.
      await page.evaluate(() => wcDoneEditing());
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => ({
        tab: (document.querySelector('.tab-content.active') || {}).id,
        shell: (document.getElementById('cvShell') || {}).style.display,
        picker: document.body.classList.contains('wb-picker'),
      }));
      check(`${width}: Done Editing lands in the Back Office`, after.tab === 'panel-backoffice', JSON.stringify(after));
      check(`${width}: and puts the editor shell away`, after.shell === 'none', JSON.stringify(after));

      await ctx.close();
    }

    // The saved document must actually carry the edit.
    const site = await (await fetch(B + '/api/personal-site', { headers: AJ })).json();
    const cfg = site.site && site.site.config ? JSON.stringify(site.site.config) : '';
    check('the edit survived to the database', /BROWSER CHECK/.test(cfg), cfg.slice(0, 120));

    // Uncaught JS is a failure. Network noise is REPORTED, not asserted: this
    // harness runs without API keys, so some calls legitimately 4xx.
    check('no uncaught JavaScript anywhere', errs.length === 0, errs.join(' | '));
    console.log('\nnetwork (informational):');
    for (const n of [...new Set(net)]) console.log('  ' + n);
  } catch (e) {
    failures++; console.error('FAIL  unexpected —', e && e.stack);
  }
  await browser.close();
  console.log(`\n${failures ? 'FAILED' : 'ALL PASS'} (${failures} failure${failures === 1 ? '' : 's'})`);
  server.close(); db.close();
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  process.exit(failures ? 1 : 0);
});
