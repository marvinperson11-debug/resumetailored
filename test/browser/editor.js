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

/* ONE PRO ACCOUNT PER WIDTH. Sharing one meant the phone pass opened the site
   the desktop pass had just typed in and dragged around, so its failures were
   inherited state rather than anything about phones. Each width starts clean. */
const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
const USERS = { 1440: { email: 'desk@x.com', token: 'tokDesk', name: 'desk' }, 390: { email: 'phone@x.com', token: 'tokPhone', name: 'phone' } };
for (const u of Object.values(USERS)) {
  db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run(u.email, u.name, 'x');
  db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run(u.token, u.email);
  db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run(u.email, 'c_' + u.name);
}
const RESUME = 'Alice Nakamura\nalice@example.com | Seattle\n\nSUMMARY\nStaff engineer with 10 years.\n\nEXPERIENCE\nStaff Engineer, Northwind\n• Cut p99 latency by 40%\n\nSKILLS\nGo, Postgres';

let failures = 0;
const check = (n, c, d) => { if (c) console.log('PASS  ' + n); else { failures++; console.error('FAIL  ' + n + (d ? ' — ' + d : '')); } };

const server = app.listen(0, async () => {
  const port = server.address().port, B = `http://127.0.0.1:${port}`;
  const AJ = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });
  for (const u of Object.values(USERS)) {
    await fetch(B + '/api/resumes', { method: 'POST', headers: AJ(u.token), body: JSON.stringify({ title: 'SWE Resume', content: RESUME }) });
  }

  // playwright-core ships no browser. Point CHROME_PATH at one, or let it fall
  // back to a Playwright-managed Chromium if the full `playwright` is present.
  const exe = process.env.CHROME_PATH || null;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const errs = [], posts = [], net = [];
  try {
    for (const width of [1440, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      /* Fail third-party requests FAST instead of letting them hang. This is
         not cosmetic: a pending stylesheet blocks script execution, and the
         canvas's inline editor is a script — so an unreachable Google Fonts
         left the whole edit layer un-initialised and made typing look broken
         for reasons that have nothing to do with the code under test. A real
         browser on a real network resolves these in milliseconds. */
      await ctx.route('**/*', (r) => {
        const u = r.request().url();
        return /^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(u) ? r.continue() : r.abort();
      });
      const page = await ctx.newPage();
      page.on('pageerror', e => errs.push(width + 'px: ' + e.message));
      page.on('requestfailed', r => net.push(width + 'px FAILED ' + r.url() + ' — ' + (r.failure() || {}).errorText));
      page.on('response', r => { if (r.status() >= 400) net.push(width + 'px ' + r.status() + ' ' + r.url()); });
      page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/personal-site')) posts.push({ width, url: r.url() }); });

      const who = USERS[width];
      await page.addInitScript((u) => {
        localStorage.setItem('rt_token', u.token);
        localStorage.setItem('rt_email', u.email);
        localStorage.setItem('rt_username', u.name);
      }, who);
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

      /* ── TYPING ON THE CANVAS ───────────────────────────────────────────
         Driven with the real mouse and the real keyboard, because the whole
         feature is about what a press and a keystroke do. Asserted on the
         DOCUMENT INSIDE THE IFRAME — is the caret in the real text node? — not
         on any parent-side variable. */
      const pickId = await page.evaluate(() => {
        const d = edStore.getDoc();
        let found = null;
        SiteDocStore.eachElement(d, (el) => {
          if (!found && /^(heading|subheading|paragraph)$/.test(el.type) && (el.props || {}).text) found = el.id;
        });
        if (found) edSelect(found);
        return found;
      });
      // The canvas stage scrolls, so the box can sit outside the viewport. Ask
      // Playwright for its real on-screen position rather than computing one.
      const boxAt = async (id) => {
        const loc = page.locator(`.ed-box[data-el="${id}"]`);
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        const b = await loc.boundingBox();
        return b ? { x: b.x + b.width / 2, y: b.y + Math.min(12, b.height / 2), box: b } : null;
      };
      const at = pickId ? await boxAt(pickId) : null;
      const target = at ? { id: pickId, x: at.x, y: at.y } : null;
      check(`${width}: the canvas has a text element to type in`, !!target && target.y > 0, JSON.stringify(target));

      /* Is that point actually CLICKABLE, or is something sitting on top of it?
         The floating inspector covered the canvas at phone width and made the
         second tap impossible — a bug that a coordinate check cannot see,
         because the coordinates were perfectly correct. */
      if (target) {
        const hit = await page.evaluate((t) => {
          const top = document.elementFromPoint(t.x, t.y);
          return { tag: top && top.tagName, cls: top && top.className, isBox: !!(top && top.closest && top.closest(`.ed-box[data-el="${t.id}"]`)) };
        }, target);
        check(`${width}: nothing covers the element you are trying to edit`, hit.isBox, JSON.stringify(hit));
      }

      if (target) {
        // The affordance has to be on screen, or nobody discovers this.
        const tip = await page.evaluate((id) => {
          const t = document.querySelector(`.ed-box[data-el="${id}"] .ed-tip`);
          return t ? { text: t.textContent.trim(), visible: t.offsetWidth > 0 } : null;
        }, target.id);
        check(`${width}: the selected text box says you can type in it`, tip && tip.visible && /type/i.test(tip.text), JSON.stringify(tip));

        // Press and release without moving: that means "type", not "drag".
        await page.mouse.move(target.x, target.y);
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForTimeout(500);

        const live = await page.evaluate((id) => {
          const f = document.getElementById('wcEdFrame');
          const doc = f.contentDocument;
          const wrap = doc.querySelector(`.sd-el[data-el="${id}"]`);
          const t = wrap && (wrap.firstElementChild || wrap);
          return {
            editable: !!(t && t.isContentEditable),
            focused: !!(t && doc.activeElement === t),
            overlayPE: getComputedStyle(document.getElementById('wcEdOverlay')).pointerEvents,
          };
        }, target.id);
        check(`${width}: a press on the selected text opens a caret in the real text`, live.editable && live.focused, JSON.stringify(live));
        check(`${width}: and the overlay stops swallowing the pointer`, live.overlayPE === 'none', JSON.stringify(live));

        // Type for real, then commit with Enter.
        const typed = 'Typed In Canvas ' + width;
        await page.keyboard.press('Control+A');
        await page.keyboard.type(typed);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(900);

        const outcome = await page.evaluate((args) => {
          const hit = SiteDocStore.findElement(edStore.getDoc(), args.id);
          const f = document.getElementById('wcEdFrame');
          return {
            docText: hit ? (hit.el.props || {}).text : null,
            detached: hit ? !!(hit.el.props || {}).detached : false,
            overlayPE: getComputedStyle(document.getElementById('wcEdOverlay')).pointerEvents,
            onCanvas: (f.contentDocument.body.innerText || '').includes(args.typed),
            canUndo: edStore.canUndo(),
          };
        }, { id: target.id, typed });
        check(`${width}: what was typed is in the document`, outcome.docText === typed, JSON.stringify(outcome));
        check(`${width}: and on the canvas`, outcome.onCanvas, JSON.stringify(outcome));
        check(`${width}: the field detaches from the resume once you write it`, outcome.detached, JSON.stringify(outcome));
        check(`${width}: the overlay takes the pointer back`, outcome.overlayPE !== 'none', JSON.stringify(outcome));
        check(`${width}: and the edit is undoable like any other`, outcome.canUndo, JSON.stringify(outcome));

        // Dragging an already-selected text element must still MOVE it.
        const before2 = await page.evaluate((id) => { edSelect(id); return SiteDocStore.findElement(edStore.getDoc(), id).el.y; }, target.id);
        const at2 = await boxAt(target.id);
        const moved = { before: before2, x: at2.x, y: at2.y };
        await page.mouse.move(moved.x, moved.y);
        await page.mouse.down();
        await page.mouse.move(moved.x, moved.y + 60, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        const afterDrag = await page.evaluate((args) => {
          const hit = SiteDocStore.findElement(edStore.getDoc(), args.id);
          const f = document.getElementById('wcEdFrame');
          const wrap = f.contentDocument.querySelector(`.sd-el[data-el="${args.id}"]`);
          const t = wrap && (wrap.firstElementChild || wrap);
          return { after: hit.el.y, typing: !!(t && t.isContentEditable) };
        }, { id: target.id });
        check(`${width}: dragging a selected text element still moves it`, afterDrag.after > moved.before, JSON.stringify({ moved, afterDrag }));
        check(`${width}: and a drag never opens a caret`, !afterDrag.typing, JSON.stringify(afterDrag));
      }

      /* ── THE GEAR ───────────────────────────────────────────────────────
         The property controls already existed in a docked panel. The gear
         brings the SAME panel to the element. Measured as geometry — is it on
         screen, is it near the box, is it inside the viewport — because "the
         panel is open" was true of the docked one for months while nobody
         could see it. */
      if (target) {
        const gear = await page.evaluate((id) => {
          const g = document.querySelector(`.ed-box[data-el="${id}"] .ed-gear`);
          if (!g) return null;
          const r = g.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }, target.id);
        check(`${width}: the selected box carries a gear`, !!gear && gear.w >= 24 && gear.h >= 20, JSON.stringify(gear));
        // Same trap, same measurement: the resize handle is inside the scaled
        // wrap too, and 14px at 0.29 is four pixels of target.
        const handle = await page.evaluate((id) => {
          const h = document.querySelector(`.ed-box[data-el="${id}"] .ed-h-se`);
          if (!h) return null;
          const r = h.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        }, target.id);
        check(`${width}: and a resize handle big enough to grab`, !!handle && handle.w >= 12 && handle.h >= 12, JSON.stringify(handle));

        await page.locator(`.ed-box[data-el="${target.id}"] .ed-gear`).click();
        await page.waitForTimeout(300);
        const panel = await page.evaluate((id) => {
          const b = document.getElementById('wcEdInspector');
          const r = b.getBoundingClientRect();
          const a = document.querySelector(`.ed-box[data-el="${id}"]`).getBoundingClientRect();
          return {
            float: b.classList.contains('is-float'),
            onScreen: r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0
              && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
            gapX: Math.round(Math.min(Math.abs(r.left - a.right), Math.abs(a.left - r.right))),
            controls: b.querySelectorAll('input,select,textarea,button').length,
            hasSize: !!b.querySelector('input[oninput*="\'size\'"]'),
            hasWeight: !!b.querySelector('select[onchange*="\'weight\'"]'),
            hasLh: !!b.querySelector('input[oninput*="\'lh\'"]'),
            hasDup: !!b.querySelector('button[onclick*="edDuplicateSel"]'),
            hasLayer: !!b.querySelector('button[onclick*="edNudgeZ"]'),
          };
        }, target.id);
        check(`${width}: the gear opens the panel as a float`, panel.float, JSON.stringify(panel));
        check(`${width}: entirely inside the viewport`, panel.onScreen, JSON.stringify(panel));
        if (width >= 821) check(`${width}: and anchored beside the element`, panel.gapX <= 40, JSON.stringify(panel));
        check(`${width}: it carries the size, weight and spacing controls`, panel.hasSize && panel.hasWeight && panel.hasLh, JSON.stringify(panel));
        check(`${width}: plus duplicate and layer order`, panel.hasDup && panel.hasLayer, JSON.stringify(panel));

        // Change the colour and the size, and prove the CANVAS changes.
        const styled = await page.evaluate(async (id) => {
          edSelect(id);
          edSetProp('color', '#e11d48');
          edSetNum('size', '61', 8, 200);
          edSetProp('weight', '800');
          await new Promise((r) => setTimeout(r, 1200));
          const f = document.getElementById('wcEdFrame');
          const node = f.contentDocument.querySelector(`.sd-el[data-el="${id}"]`);
          const t = node && (node.firstElementChild || node);
          const cs = t && getComputedStyle(t);
          return cs ? { color: cs.color, size: cs.fontSize, weight: cs.fontWeight } : null;
        }, target.id);
        check(`${width}: a colour change reaches the rendered page`, styled && styled.color === 'rgb(225, 29, 72)', JSON.stringify(styled));
        check(`${width}: so does a size change`, styled && styled.size === '61px', JSON.stringify(styled));
        check(`${width}: so does a weight change`, styled && styled.weight === '800', JSON.stringify(styled));

        // Duplicate: a real second element, selected, not on top of the first.
        const dup = await page.evaluate((id) => {
          edSelect(id);
          const n0 = document.querySelectorAll('.ed-box').length;
          const before = SiteDocStore.findElement(edStore.getDoc(), id).el;
          edDuplicateSel();
          const copy = SiteDocStore.findElement(edStore.getDoc(), edSel);
          return { n0, n1: document.querySelectorAll('.ed-box').length, newSel: edSel !== id,
                   offsetX: copy ? copy.el.x - before.x : 0, offsetY: copy ? copy.el.y - before.y : 0,
                   sameText: copy ? (copy.el.props || {}).text === (before.props || {}).text : false };
        }, target.id);
        check(`${width}: duplicate makes a second element`, dup.n1 === dup.n0 + 1, JSON.stringify(dup));
        check(`${width}: with the same content, offset so you can see it`, dup.sameText && dup.offsetX === 20 && dup.offsetY === 20, JSON.stringify(dup));
        check(`${width}: and the copy is what is now selected`, dup.newSel, JSON.stringify(dup));

        // Close the gear so the rest of the run is not behind a panel.
        await page.evaluate(() => { if (_edGearOpen) edToggleGear(); });
      }

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
    for (const [w, u] of Object.entries(USERS)) {
      const site = await (await fetch(B + '/api/personal-site', { headers: AJ(u.token) })).json();
      const cfg = site.site && site.site.config ? JSON.stringify(site.site.config) : '';
      check(`${w}: the edit survived to the database`, /BROWSER CHECK/.test(cfg), cfg.slice(0, 160));
      check(`${w}: and so did what was typed on the canvas`, new RegExp('Typed In Canvas ' + w).test(cfg), cfg.slice(0, 160));
    }

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
