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
/* A one-pixel PNG. The upload path is the thing under test, not the file. */
const PIXEL = path.join(os.tmpdir(), 'rt-pixel.png');
fs.writeFileSync(PIXEL, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

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
      page.on('pageerror', e => errs.push(width + 'px: ' + e.message + ' :: ' + String(e.stack || '').split('\n').slice(0, 3).join(' | ')));
      page.on('requestfailed', r => net.push(width + 'px FAILED ' + r.url() + ' — ' + (r.failure() || {}).errorText));
      page.on('response', r => { if (r.status() >= 400) net.push(width + 'px ' + r.status() + ' ' + r.url()); });
      page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/personal-site')) posts.push({ width, url: r.url() }); });

      const who = USERS[width];
      /* Top frame only, and guarded. addInitScript runs in EVERY frame — once a
         map element exists the page contains a cross-origin maps.google.com
         iframe where storage is denied, and seeding the session there threw a
         SecurityError that looked like a product bug. */
      await page.addInitScript((u) => {
        if (window.top !== window.self) return;
        try {
          localStorage.setItem('rt_token', u.token);
          localStorage.setItem('rt_email', u.email);
          localStorage.setItem('rt_username', u.name);
        } catch (_) {}
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

      /* ── THE PICKER'S LAYOUT ────────────────────────────────────────────
         Measured, at the width it is being measured at. On a phone this was
         one column of twelve full-width cards — and the panel inherited the
         editor's 56px rail offset while also being 100% wide, so the whole
         gallery sat pushed right with 56px of itself off the screen. */
      const pick = await page.evaluate(() => {
        const g = document.getElementById('wcTplGrid');
        const p = document.getElementById('cvPanel');
        const ch = document.getElementById('wcTplCats');
        const cards = [...g.querySelectorAll('.wc-tpl')];
        const pr = p.getBoundingClientRect();
        return {
          cols: getComputedStyle(g).gridTemplateColumns.split(' ').length,
          rows: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top))).size,
          cardW: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0,
          cardH: cards[0] ? Math.round(cards[0].getBoundingClientRect().height) : 0,
          thumbH: cards[0] ? Math.round(cards[0].querySelector('.wc-tpl-thumb').getBoundingClientRect().height) : 0,
          panelLeft: Math.round(pr.left), panelRight: Math.round(pr.right),
          chipsWrap: getComputedStyle(ch).flexWrap, chipsX: getComputedStyle(ch).overflowX,
          chipsH: Math.round(ch.getBoundingClientRect().height),
          pageH: Math.round(p.scrollHeight),
          docOverflowsX: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      if (width <= 560) {
        check(`${width}: the picker shows two templates per row, not one`,
          pick.cols === 2 && pick.rows === 6, JSON.stringify(pick));
        check(`${width}: with smaller cards`, pick.cardW < 200 && pick.cardH < 220, JSON.stringify(pick));
        check(`${width}: the panel fills the screen instead of hanging off it`,
          pick.panelLeft === 0 && !pick.docOverflowsX && pick.panelRight <= width + 1, JSON.stringify(pick));
        check(`${width}: the filter pills scroll sideways rather than stacking`,
          pick.chipsWrap === 'nowrap' && pick.chipsX === 'auto' && pick.chipsH < 45, JSON.stringify(pick));
        /* The complaint was the scrolling. One column of twelve measured 3479px
           of page; anything near that is the bug still being there. */
        check(`${width}: and the whole gallery is roughly half the scroll it was`,
          pick.pageH < 1800, JSON.stringify(pick));
      } else {
        /* DESKTOP IS UNTOUCHED. Every rule added for the phone is inside a
           max-width query and prefixed `body.wb-picker`; this is the check that
           says so in numbers rather than in a promise. */
        check(`${width}: desktop card geometry is unchanged`,
          pick.cardW === 240 && pick.cardH === 257 && pick.thumbH === 150, JSON.stringify(pick));
        check(`${width}: and its filter pills still wrap as they did`,
          pick.chipsWrap === 'wrap', JSON.stringify(pick));
      }

      /* ── THE TEMPLATE-CARD PREVIEW ──────────────────────────────────────
         Two bugs lived in this modal, and both were invisible to every check
         that looked at variables instead of at the screen.

         1. The device toggle. The frame was `width:100%; max-width: mobile ?
            390 : 980`. Inside a phone-sized modal the container is about 326px
            — BELOW both caps — so neither bound and the two views rendered the
            identical page. Measured on the LAYOUT WIDTH OF THE PAGE INSIDE,
            because the frame's own width is 326 either way and says nothing.

         2. Close showed a blank screen. A document-level "clicking the page
            retracts the panel" handler treated clicks inside this modal — which
            is a sibling of the shell, not a descendant of .cv-panel — as clicks
            on the page. So opening the preview and touching anything in it hid
            the gallery BEHIND it, and closing revealed a shell with no panel,
            no rail and no canvas. The DOM reported 12 tiles and an active
            panel throughout; the screen was empty. Hence elementFromPoint. */
      await page.locator('.wc-tpl button', { hasText: /^(Preview|预览)$/ }).first().click();
      await page.waitForTimeout(2500);
      const tplShot = () => {
        const f = document.getElementById('wcTplFrame');
        let inner = -1;
        try { inner = f.contentDocument.documentElement.clientWidth; } catch (_) {}
        const st = document.getElementById('wcTplStage');
        const box = document.getElementById('wcTplBox');
        return { inner, frameW: Math.round(f.getBoundingClientRect().width),
          boxW: box ? Math.round(box.getBoundingClientRect().width) : -1,
          stageW: st ? st.clientWidth : -1,
          deskOn: document.getElementById('wcTplDesktop').classList.contains('wc-vtab-active'),
          mobOn: document.getElementById('wcTplMobile').classList.contains('wc-vtab-active') };
      };
      const tplDesk = await page.evaluate(tplShot);
      await page.click('#wcTplMobile');
      await page.waitForTimeout(1200);
      const tplMob = await page.evaluate(tplShot);

      check(`${width}: the template preview's phone button changes what it renders`,
        tplMob.inner === 390 && tplDesk.inner > 390 && tplMob.inner !== tplDesk.inner,
        JSON.stringify({ tplDesk, tplMob }));
      check(`${width}: and its desktop view really is a desktop layout`,
        tplDesk.inner > 820, JSON.stringify(tplDesk));
      check(`${width}: with both fitted inside the modal, not overflowing it`,
        tplMob.boxW <= tplMob.stageW && tplDesk.boxW <= tplDesk.stageW,
        JSON.stringify({ tplDesk, tplMob }));
      check(`${width}: and the highlight follows`, tplMob.mobOn && !tplMob.deskOn, JSON.stringify(tplMob));

      // Close — and the gallery has to be ON SCREEN, not merely in the document.
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('#wcTplModal button')]
          .find((x) => /closeTplPreview/.test(x.getAttribute('onclick') || '') && !/event\.target/.test(x.getAttribute('onclick') || ''));
        if (b) b.click();
      });
      await page.waitForTimeout(1200);
      const afterClose = await page.evaluate(() => {
        const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        const card = document.querySelector('.wc-tpl');
        const cr = card ? card.getBoundingClientRect() : null;
        const panel = document.getElementById('cvPanel');
        return {
          modal: getComputedStyle(document.getElementById('wcTplModal')).display,
          panelDisp: getComputedStyle(panel).display, panelHidden: panel.hidden,
          panelW: Math.round(panel.getBoundingClientRect().width),
          centreHit: hit ? (hit.id || (typeof hit.className === 'string' ? hit.className.trim().slice(0, 24) : hit.tagName)) : 'NOTHING',
          centreInPanel: !!(hit && panel.contains(hit)),
          cardW: cr ? Math.round(cr.width) : 0, cardH: cr ? Math.round(cr.height) : 0,
        };
      });
      check(`${width}: closing the template preview goes back to the picker`,
        afterClose.modal === 'none' && !afterClose.panelHidden && afterClose.panelDisp !== 'none' && afterClose.panelW > 0,
        JSON.stringify(afterClose));
      /* THE ONE THAT MATTERS. Everything above was already true while the
         screen was blank — the panel was `hidden`, and the empty canvas stage
         was what filled the window. This asks what is actually under the middle
         of the screen. */
      check(`${width}: and the gallery is what is ON SCREEN, not an empty stage`,
        afterClose.centreInPanel && afterClose.cardW > 0 && afterClose.cardH > 0,
        JSON.stringify(afterClose));

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

      /* ── THE CANVAS DOES NOT MOVE SIDEWAYS ──────────────────────────────
         `transform: scale()` changes what is painted and NOTHING about the
         layout box, so #wcEdWrap stayed 1200px wide however far it was scaled
         down and the stage scrolled to reach the rest of it — measured at 47px
         on a 1440px laptop and 443px on a 390px phone before this was fixed.

         Measured by actually SCROLLING, not by comparing numbers: scrollWidth
         and clientWidth have agreed while a sub-pixel rounding still left the
         thing draggable, and "it can be scrolled" is the complaint. The check
         runs again after the mobile toggle and after a zoom, because each one
         re-fits the stage and each is its own chance to put it back. */
      const noPan = async (when) => page.evaluate(async () => {
        await new Promise((r) => setTimeout(r, 700));
        const st = document.getElementById('wcEdStage');
        const box = st.querySelector('.cv-canvasbox');
        const before = st.scrollLeft;
        st.scrollLeft = 9999; const moved = st.scrollLeft; st.scrollLeft = before;
        const sr = st.getBoundingClientRect(), br = box.getBoundingClientRect();
        return {
          moved, sw: st.scrollWidth, cw: st.clientWidth,
          // Gap either side of the canvas: equal means centred.
          gapL: Math.round(br.left - sr.left), gapR: Math.round(sr.right - br.right),
          boxW: Math.round(br.width), spillsRight: Math.round(br.right - sr.right),
          // The page the canvas is DRAWING (1200 desktop / 390 phone), as
          // opposed to the size it is drawn at. Both are clamped to the stage
          // on a phone, so only this tells the two views apart there.
          frameW: Math.round(document.getElementById('wcEdFrame').offsetWidth),
          docPans: document.documentElement.scrollWidth > innerWidth + 1,
        };
      }).then((r) => ({ when, ...r }));

      const panEdit = await noPan('canvas');
      check(`${width}: the canvas cannot be dragged sideways`,
        panEdit.moved === 0 && panEdit.sw <= panEdit.cw, JSON.stringify(panEdit));
      check(`${width}: and sits centred in the stage`,
        Math.abs(panEdit.gapL - panEdit.gapR) <= 1 && panEdit.spillsRight <= 0, JSON.stringify(panEdit));
      check(`${width}: the page itself does not scroll sideways either`, !panEdit.docPans, JSON.stringify(panEdit));

      await page.evaluate(() => edSetDevice('mobile'));
      const panMob = await noPan('mobile device');
      check(`${width}: still cannot after switching to the phone view`,
        panMob.moved === 0 && panMob.sw <= panMob.cw, JSON.stringify(panMob));
      check(`${width}: and is still centred there`,
        Math.abs(panMob.gapL - panMob.gapR) <= 1, JSON.stringify(panMob));
      /* The phone view really is drawing a phone-width page — otherwise "it
         doesn't scroll" could be satisfied by a toggle that stopped doing
         anything at all. Measured on the FRAME, not on the box: at a 390px
         window both views are clamped to the same 294px of stage, so the box
         width cannot tell them apart there and an earlier version of this
         check failed for that reason rather than for a real one. */
      check(`${width}: and the phone view is genuinely drawing a phone-width page`,
        panMob.frameW === 390 && panEdit.frameW === 1200,
        `desktop frame=${panEdit.frameW} phone frame=${panMob.frameW}`);
      check(`${width}: with the phone canvas still inside the stage`,
        panMob.boxW <= panMob.cw && panMob.spillsRight <= 0, JSON.stringify(panMob));

      await page.evaluate(() => { edSetDevice('desktop'); if (typeof cvSetZoom === 'function') cvSetZoom(50); });
      const panZoom = await noPan('zoom 50%');
      check(`${width}: and not after zooming out`,
        panZoom.moved === 0 && panZoom.boxW < panEdit.boxW, JSON.stringify(panZoom));
      await page.evaluate(() => { if (typeof cvSetZoom === 'function') cvSetZoom(100); });
      await page.waitForTimeout(600);

      /* SELECTING IS SILENT. The panel used to appear the moment anything was
         selected — a wall of controls over the canvas every time you touched
         your own page. Measured as what is ON SCREEN, because `hidden` being
         set has been true while the thing was still visible before. */
      const sel = await page.evaluate(() => {
        const el = document.querySelector('[data-el]');
        if (!el) return null;
        edSelect(el.getAttribute('data-el'));
        const box = document.getElementById('wcEdInspector');
        return { id: edSel, hidden: box.hidden, onScreen: box.offsetWidth > 0 && box.offsetHeight > 0 };
      });
      check(`${width}: selecting an element does NOT open the panel`,
        sel && sel.id && !sel.onScreen, JSON.stringify(sel));

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
      /* A point that really belongs to this element.

         The canvas stage scrolls, so a box can sit outside the viewport — and
         template elements OVERLAP, so the geometric centre of one box is
         sometimes inside another that paints on top of it. Pressing a computed
         midpoint selected a photo when the test meant a heading, and every
         typing assertion after it failed for a reason that had nothing to do
         with typing.

         So: scroll it in, then ask the browser what is actually at each
         candidate point and take the first that answers with this element. */
      const boxAt = async (id) => {
        const loc = page.locator(`.ed-box[data-el="${id}"]`);
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        if (!(await loc.boundingBox())) return null;
        return page.evaluate((i) => {
          const b = document.querySelector(`.ed-box[data-el="${i}"]`);
          if (!b) return null;
          const r = b.getBoundingClientRect();
          const cands = [
            [r.left + r.width / 2, r.top + Math.min(12, r.height / 2)],
            [r.left + r.width / 2, r.top + r.height / 2],
            [r.left + 8, r.top + 8],
            [r.right - 8, r.bottom - 8],
            [r.left + r.width / 2, r.bottom - 8],
          ];
          for (const [x, y] of cands) {
            const top = document.elementFromPoint(x, y);
            if (top && top.closest && top.closest(`.ed-box[data-el="${i}"]`)) return { x, y, box: { x: r.x, y: r.y, width: r.width, height: r.height }, clean: true };
          }
          return { x: cands[0][0], y: cands[0][1], box: { x: r.x, y: r.y, width: r.width, height: r.height }, clean: false };
        }, id);
      };
      const at = pickId ? await boxAt(pickId) : null;
      const target = at ? { id: pickId, x: at.x, y: at.y } : null;
      check(`${width}: the canvas has a text element to type in`, !!target && target.y > 0, JSON.stringify(target));

      /* Is that point actually CLICKABLE, or is something sitting on top of it?
         The floating inspector covered the canvas at phone width and made the
         second tap impossible — a bug that a coordinate check cannot see,
         because the coordinates were perfectly correct. `clean` is false when
         no point on the element could be reached at all. */
      if (target) {
        check(`${width}: nothing covers the element you are trying to edit`, at.clean, JSON.stringify(at));
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
        /* Wait for the CARET, not for a fixed number of milliseconds. The press
           only asks the page to begin editing; the iframe answers when it gets
           round to it, and a 500ms sleep passed here for weeks and then started
           failing the moment the canvas got heavier. Sleeping a guess is how a
           test tells you about your machine instead of your code. */
        await page.waitForFunction((i) => {
          const f = document.getElementById('wcEdFrame');
          const w = f && f.contentDocument && f.contentDocument.querySelector(`.sd-el[data-el="${i}"]`);
          const t = w && (w.firstElementChild || w);
          return !!(t && t.isContentEditable);
        }, target.id, { timeout: 6000 }).catch(() => {});
        if (process.env.RT_DEBUG) console.log('DEBUG press:', JSON.stringify(await page.evaluate((i) => ({
          sel: edSel, typing: _edTyping, gear: _edGearOpen, isText: edIsText(i), media: edMediaType(i),
          ready: _edCanvasReady, pending: _edPendingEdit,
          frameState: (() => { const f = document.getElementById('wcEdFrame'); return f && f.contentDocument ? f.contentDocument.readyState : 'no-doc'; })(),
          layerRan: (() => { const f = document.getElementById('wcEdFrame'); const d = f && f.contentDocument; return d ? d.querySelectorAll('script').length : -1; })(),
          box: !!document.querySelector(`.ed-box[data-el="${i}"]`),
          top: (() => { const b = document.querySelector(`.ed-box[data-el="${i}"]`); if (!b) return null; const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + 12); return t ? (t.className || t.tagName) : null; })(),
        }), target.id)));

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
        const openedByGear = await page.evaluate(() => {
          const b = document.getElementById('wcEdInspector');
          return { onScreen: b.offsetWidth > 0 && b.offsetHeight > 0, float: b.classList.contains('is-float') };
        });
        check(`${width}: the gear is the thing that opens it`, openedByGear.onScreen, JSON.stringify(openedByGear));
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

        /* ── ADD INTO A BOX ─────────────────────────────────────────────────
           The document is flat, so "into this box" means placed inside the
           selected element's rectangle when it fits, and immediately beneath it
           when it does not. Checked as geometry, and checked BOTH ways: a tall
           box has an inside, a 40px heading does not. */
        const addInto = await page.evaluate(() => {
          // A host with room inside it.
          const id = SiteDocStore.newId('host');
          edApply((d) => {
            const p = SiteDocStore.findPage(d, edPageId);
            p.sections[0].els.push({ id, type: 'box', x: 100, y: 60, w: 500, h: 400, z: 3, props: { bg: 'eeeeee' } });
            if (p.sections[0].h < 520) p.sections[0].h = 520;
          });
          edSelect(id);
          const host = SiteDocStore.findElement(edStore.getDoc(), id).el;
          edAddInto('text');
          const kid = SiteDocStore.findElement(edStore.getDoc(), edSel).el;
          return {
            selectedIsNew: edSel !== id,
            type: kid.type,
            inside: kid.x >= host.x && kid.y >= host.y
              && kid.x + kid.w <= host.x + host.w && kid.y + kid.h <= host.y + host.h,
            above: (kid.z || 0) > (host.z || 0),
            hasText: !!(kid.props || {}).text,
          };
        });
        check(`${width}: adding into a box with room puts it inside`, addInto.inside, JSON.stringify(addInto));
        check(`${width}: on top of the box, not behind it`, addInto.above, JSON.stringify(addInto));
        check(`${width}: and selects what was just added`, addInto.selectedIsNew && addInto.type === 'paragraph', JSON.stringify(addInto));
        check(`${width}: with real content, not an empty shell`, addInto.hasText, JSON.stringify(addInto));

        const addBelow = await page.evaluate(() => {
          const id = SiteDocStore.newId('thin');
          edApply((d) => {
            const p = SiteDocStore.findPage(d, edPageId);
            p.sections[0].els.push({ id, type: 'heading', x: 100, y: 20, w: 300, h: 40, z: 1, props: { text: 'Thin' } });
          });
          edSelect(id);
          const host = SiteDocStore.findElement(edStore.getDoc(), id).el;
          edAddInto('text');
          const kid = SiteDocStore.findElement(edStore.getDoc(), edSel).el;
          return { hostBottom: host.y + host.h, kidY: kid.y, w: kid.w };
        });
        check(`${width}: a box with no room inside gets it directly beneath`,
          addBelow.kidY >= addBelow.hostBottom, JSON.stringify(addBelow));

        // Media kinds place a real element and go straight to the file picker.
        const media = await page.evaluate(async () => {
          const id = SiteDocStore.newId('m');
          edApply((d) => {
            const p = SiteDocStore.findPage(d, edPageId);
            p.sections[0].els.push({ id, type: 'box', x: 100, y: 600, w: 500, h: 400, z: 1, props: {} });
            if (p.sections[0].h < 1060) p.sections[0].h = 1060;
          });
          edSelect(id);
          // Catch the file input the picker creates rather than opening a real
          // OS dialog: what matters here is that the element is placed and the
          // picker is offered with the right filter.
          let accept = null;
          const realClick = HTMLInputElement.prototype.click;
          HTMLInputElement.prototype.click = function () { if (this.type === 'file') { accept = this.accept; return; } return realClick.call(this); };
          const out = {};
          for (const kind of ['photo', 'video', 'voice']) {
            accept = null;
            edSelect(id);
            edAddInto(kind);
            const kid = SiteDocStore.findElement(edStore.getDoc(), edSel).el;
            out[kind] = { type: kid.type, accept };
          }
          HTMLInputElement.prototype.click = realClick;
          return out;
        });
        check(`${width}: photo adds an image and asks for an image file`,
          media.photo.type === 'image' && /image\//.test(media.photo.accept || ''), JSON.stringify(media));
        check(`${width}: video adds a video and asks for a video file`,
          media.video.type === 'video' && /video\//.test(media.video.accept || ''), JSON.stringify(media));
        check(`${width}: voice adds audio and asks for an audio file`,
          media.voice.type === 'audio' && /audio\//.test(media.voice.accept || ''), JSON.stringify(media));

        /* ── THE SIX ────────────────────────────────────────────────────────
           Forms, maps, social, animations, fonts, buttons. Each one is checked
           through the panel a user actually operates, and then read back off
           the RENDERED page inside the canvas — the document agreeing with
           itself proves nothing about what the page shows. */
        const sixFromPalette = await page.evaluate(() => {
          const want = ['Map', 'Social icons', 'Find me on…', 'Download CV', 'Email me', 'Book a call'];
          const have = [];
          ED_PALETTE.forEach((g) => g.items.forEach((i) => { if (want.includes(i.label)) have.push(i.label + ':' + i.type); }));
          return have;
        });
        check(`${width}: the palette offers maps, social and the common buttons`,
          sixFromPalette.length === 6 && sixFromPalette.includes('Map:map')
          && sixFromPalette.includes('Find me on…:social'), JSON.stringify(sixFromPalette));

        // MAP — typed address reaches the embed inside the canvas.
        const mapOut = await page.evaluate(async () => {
          const id = SiteDocStore.newId('map');
          edApply((d) => {
            const p = SiteDocStore.findPage(d, edPageId);
            p.sections[0].els.push({ id, type: 'map', x: 40, y: 40, w: 500, h: 300, props: { zoom: 13 } });
          });
          edSelect(id);
          edSetProp('address', '1 Market St, San Francisco');
          edSetNum('zoom', '16', 1, 20);
          await new Promise((r) => setTimeout(r, 1200));
          const f = document.getElementById('wcEdFrame');
          const fr = f.contentDocument.querySelector(`.sd-el[data-el="${id}"] iframe.sd-map`);
          return { src: fr ? fr.getAttribute('src') : null };
        });
        check(`${width}: a map renders at the address typed, at the chosen zoom`,
          !!mapOut.src && /1%20Market%20St/.test(mapOut.src) && /z=16/.test(mapOut.src), JSON.stringify(mapOut));

        // SOCIAL — a bare handle becomes a real profile link with a real icon.
        const socOut = await page.evaluate(async () => {
          const id = SiteDocStore.newId('soc');
          edApply((d) => {
            const p = SiteDocStore.findPage(d, edPageId);
            p.sections[0].els.push({ id, type: 'social', x: 40, y: 380, w: 300, h: 44, props: { display: 'icons', items: [{ network: 'linkedin', url: '' }] } });
            if (p.sections[0].h < 600) p.sections[0].h = 600;
          });
          edSelect(id);
          edSetItem(0, 'url', 'marvinperson');
          await new Promise((r) => setTimeout(r, 1200));
          const f = document.getElementById('wcEdFrame');
          const a = f.contentDocument.querySelector(`.sd-el[data-el="${id}"] a.sd-soc`);
          return { href: a ? a.getAttribute('href') : null, svg: !!(a && a.querySelector('svg')) };
        });
        check(`${width}: a bare social handle becomes a real profile link`,
          socOut.href === 'https://www.linkedin.com/in/marvinperson', JSON.stringify(socOut));
        check(`${width}: with a real icon, not two letters of text`, socOut.svg, JSON.stringify(socOut));

        // FORM — add a field through the panel, see it on the page.
        const formOut = await page.evaluate(async () => {
          const id = SiteDocStore.newId('frm');
          edApply((d) => {
            const p = SiteDocStore.findPage(d, edPageId);
            p.sections[0].els.push({ id, type: 'form', x: 40, y: 460, w: 480, h: 300, props: { mode: 'contact' } });
            if (p.sections[0].h < 820) p.sections[0].h = 820;
          });
          edSelect(id);
          edAddField();
          const idx = edFormFields(SiteDocStore.findElement(edStore.getDoc(), id).el).length - 1;
          edSetField(idx, 'label', 'Company');
          await new Promise((r) => setTimeout(r, 1200));
          const f = document.getElementById('wcEdFrame');
          const form = f.contentDocument.querySelector(`.sd-el[data-el="${id}"] form`);
          const names = form ? [...form.querySelectorAll('input,textarea')].map((x) => x.name) : [];
          // And the fixed email row cannot be deleted.
          const before = edFormFields(SiteDocStore.findElement(edStore.getDoc(), id).el);
          edDelField(before.findIndex((x) => x.type === 'email'));
          const after = edFormFields(SiteDocStore.findElement(edStore.getDoc(), id).el);
          return { names, emailKept: after.some((x) => x.type === 'email'), n: after.length };
        });
        check(`${width}: a field added in the panel appears on the form`,
          formOut.names.includes('company'), JSON.stringify(formOut));
        check(`${width}: and the email field cannot be removed`, formOut.emailKept, JSON.stringify(formOut));

        // BUTTON — colour reaches the rendered button.
        const btnOut = await page.evaluate(async () => {
          const id = SiteDocStore.newId('btn');
          edApply((d) => {
            const p = SiteDocStore.findPage(d, edPageId);
            p.sections[0].els.push({ id, type: 'button', x: 560, y: 40, w: 220, h: 52, props: { text: 'Book a call' } });
          });
          edSelect(id);
          edSetProp('color', '#e11d48');
          edSetProp('href', 'https://cal.com/me');
          await new Promise((r) => setTimeout(r, 1200));
          const f = document.getElementById('wcEdFrame');
          const a = f.contentDocument.querySelector(`.sd-el[data-el="${id}"] a.sd-btn`);
          const cs = a && getComputedStyle(a);
          return { bg: cs ? cs.backgroundColor : null, href: a ? a.getAttribute('href') : null };
        });
        check(`${width}: a button's colour reaches the rendered page`,
          btnOut.bg === 'rgb(225, 29, 72)', JSON.stringify(btnOut));
        check(`${width}: and it links where it was told to`, btnOut.href === 'https://cal.com/me', JSON.stringify(btnOut));

        // FONTS — the Brand pane changes what the canvas is actually set in.
        const fontOut = await page.evaluate(async () => {
          cvPanel('brand');
          const sel = document.querySelectorAll('#cvBrandPanel select');
          const opts = sel.length ? [...sel[0].options].map((o) => o.value) : [];
          cvSetTheme('fontHeading', 'playfair');
          cvSetTheme('fontBody', 'karla');
          await new Promise((r) => setTimeout(r, 1400));
          const f = document.getElementById('wcEdFrame');
          const doc2 = f.contentDocument;
          const h1 = doc2.querySelector('.sd-h1');
          // The stylesheet, NOT the preconnect that precedes it and matches the
          // same host — reading the preconnect made this look like one family.
          const link = doc2.querySelector('link[rel="stylesheet"][href*="fonts.googleapis"]');
          return {
            pickers: sel.length, count: opts.length,
            headFam: h1 ? getComputedStyle(h1).fontFamily : null,
            bodyFam: getComputedStyle(doc2.body).fontFamily,
            link: link ? link.getAttribute('href') : null,
          };
        });
        check(`${width}: the Brand pane offers a heading and a body font picker`,
          fontOut.pickers >= 2 && fontOut.count >= 10, JSON.stringify({ p: fontOut.pickers, c: fontOut.count }));
        check(`${width}: choosing them changes what the page is set in`,
          /Playfair Display/.test(fontOut.headFam || '') && /Karla/.test(fontOut.bodyFam || ''), JSON.stringify(fontOut));
        check(`${width}: and both are actually requested, in one stylesheet`,
          /Playfair\+Display/.test(fontOut.link || '') && /Karla/.test(fontOut.link || ''), fontOut.link);
        await page.evaluate(() => cvClosePanel());

        // ANIMATION — the toggle writes the section, and the canvas stays still.
        const animOut = await page.evaluate(async () => {
          edSelect(document.querySelector('[data-el]').getAttribute('data-el'));
          edSetSectionAnim('up');
          await new Promise((r) => setTimeout(r, 1200));
          const hit = SiteDocStore.findElement(edStore.getDoc(), edSel);
          const f = document.getElementById('wcEdFrame');
          const sec = f.contentDocument.querySelector('section');
          return { stored: hit.section.anim, canvasAnimates: !!(sec && sec.getAttribute('data-anim')) };
        });
        check(`${width}: the section animation toggle writes the section`, animOut.stored === 'up', JSON.stringify(animOut));
        check(`${width}: but the canvas never animates, so nothing flickers`, !animOut.canvasAnimates, JSON.stringify(animOut));

        /* ── OPEN ON THE GEAR, CLOSE ON ANYTHING ELSE ───────────────────────
           Six rules, each driven with a real pointer and judged on whether the
           panel is on the glass — not on `_edGearOpen`, which has been true of
           a variable and false of the screen more than once in this feature. */
        const panelOn = () => page.evaluate(() => {
          const b = document.getElementById('wcEdInspector');
          return b.offsetWidth > 0 && b.offsetHeight > 0;
        });
        /* The gear only exists on the SELECTED box, so select first. An earlier
           version of this helper assumed the element from twenty lines up was
           still selected; a test in between had moved the selection, and
           Playwright waited thirty seconds for a button that was never going
           to be rendered. */
        const gearAt = async (id) => {
          await page.evaluate((x) => edSelect(x), id);
          const loc = page.locator(`.ed-box[data-el="${id}"] .ed-gear`);
          await loc.scrollIntoViewIfNeeded().catch(() => {});
          return loc;
        };

        /* TWO ELEMENTS OF THIS BLOCK'S OWN, in clear space below everything the
           earlier checks left behind. Reusing an element from further up cost
           thirty seconds of Playwright retries: a map added two tests ago was
           sitting on top of its gear, and "intercepts pointer events" is not a
           product bug, it is one test standing on another. */
        const [pA, pB] = await page.evaluate(() => {
          const a = SiteDocStore.newId('pa'), b = SiteDocStore.newId('pb');
          edApply((d) => {
            const p = SiteDocStore.findPage(d, edPageId);
            const s = p.sections[0];
            const y = Math.max(1200, (Number(s.h) || 0) + 60);
            s.els.push({ id: a, type: 'heading', x: 40, y, w: 420, h: 90, props: { text: 'Panel A' } });
            s.els.push({ id: b, type: 'heading', x: 40, y: y + 160, w: 420, h: 90, props: { text: 'Panel B' } });
            s.h = y + 340;
          });
          return [a, b];
        });
        await page.waitForTimeout(700);

        // 1. A press on the canvas closes it.
        await (await gearAt(pA)).click();
        await page.waitForTimeout(250);
        const beforeCanvasPress = await panelOn();
        const at3 = await boxAt(pA);
        await page.mouse.move(at3.x, at3.y);
        await page.mouse.down(); await page.mouse.up();
        await page.waitForTimeout(400);
        check(`${width}: a press on the canvas closes the panel`,
          beforeCanvasPress && !(await panelOn()), `open before=${beforeCanvasPress}`);
        await page.evaluate(() => { if (_edTyping) edEndTyping(); });

        // 2. A click outside the canvas entirely — the rail — closes it too.
        await (await gearAt(pA)).click();
        await page.waitForTimeout(250);
        const beforeOutside = await panelOn();
        await page.evaluate(() => {
          const r = document.querySelector('.cv-rail') || document.querySelector('.cv-top');
          const b = r.getBoundingClientRect();
          r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: b.x + 4, clientY: b.y + 4 }));
        });
        await page.waitForTimeout(300);
        check(`${width}: a click outside the panel closes it`,
          beforeOutside && !(await panelOn()), `open before=${beforeOutside}`);

        // 3. A click INSIDE the panel does not close it — it is where the
        //    controls are, and a panel that shut on its own controls would be
        //    unusable.
        await (await gearAt(pA)).click();
        await page.waitForTimeout(250);
        await page.evaluate(() => {
          const b = document.getElementById('wcEdInspector');
          const r = b.getBoundingClientRect();
          b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
        });
        await page.waitForTimeout(250);
        check(`${width}: clicking inside the panel keeps it open`, await panelOn());

        // 4. Selecting a different element closes the old panel and opens none.
        const at4 = await boxAt(pB);
        await page.mouse.move(at4.x, at4.y);
        await page.mouse.down(); await page.mouse.up();
        await page.waitForTimeout(400);
        const afterOther = await page.evaluate(() => ({ sel: edSel, on: (() => { const b = document.getElementById('wcEdInspector'); return b.offsetWidth > 0 && b.offsetHeight > 0; })() }));
        check(`${width}: selecting another element closes the panel and opens none`,
          afterOther.sel === pB && !afterOther.on, JSON.stringify({ afterOther, pB }));
        await page.evaluate(() => { if (_edTyping) edEndTyping(); });

        /* 5. A PHOTO OR VIDEO SLOT UPLOADS INSTEAD OF TYPING. Same gesture as
              text — press an already-selected element and release without
              moving — but there is no text to type into, so it opens the file
              picker filtered to what the slot can hold. */
        const mediaPress = await page.evaluate(async () => {
          const out = {};
          const realClick = HTMLInputElement.prototype.click;
          for (const [kind, type] of [['photo', 'image'], ['video', 'video']]) {
            const id = SiteDocStore.newId('slot');
            edApply((d) => {
              const p = SiteDocStore.findPage(d, edPageId);
              const s = p.sections[0];
              const y = (Number(s.h) || 0) + 40;      // clear of everything above
              s.els.push({ id, type, x: 40, y, w: 300, h: 200, props: {} });
              s.h = y + 260;
            });
            edSelect(id);                       // first press selects
            let accept = null, typed = false;
            HTMLInputElement.prototype.click = function () { if (this.type === 'file') { accept = this.accept; return; } return realClick.call(this); };
            // Second press, no movement: what does it do?
            const box = document.querySelector(`.ed-box[data-el="${id}"]`);
            const r = box.getBoundingClientRect();
            const opts = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1 };
            box.dispatchEvent(new PointerEvent('pointerdown', opts));
            window.dispatchEvent(new PointerEvent('pointerup', opts));
            await new Promise((rs) => setTimeout(rs, 120));
            typed = !!_edTyping;
            HTMLInputElement.prototype.click = realClick;
            out[kind] = { accept, typed };
          }
          return out;
        });
        check(`${width}: pressing a photo slot opens the image picker, not a caret`,
          /image\//.test(mediaPress.photo.accept || '') && !mediaPress.photo.typed, JSON.stringify(mediaPress));
        check(`${width}: pressing a video slot asks for a video`,
          /video\//.test(mediaPress.video.accept || '') && !mediaPress.video.typed, JSON.stringify(mediaPress));
        check(`${width}: and both still carry a gear for everything else`,
          await page.evaluate(() => !!document.querySelector('.ed-box.is-sel .ed-gear')));

        /* ── EIGHT HANDLES, ALL WORKING ─────────────────────────────────────
           One corner meant an element could only ever grow down-and-right: to
           widen something on its left you resized it and then dragged it back.
           Each direction is dragged for real and the resulting geometry read
           off the document. */
        const rz = await page.evaluate(() => {
          const id = SiteDocStore.newId('rz');
          edApply((d) => {
            const p = SiteDocStore.findPage(d, edPageId);
            const s = p.sections[0];
            const y = (Number(s.h) || 0) + 60;
            s.els.push({ id, type: 'video', x: 300, y, w: 300, h: 200, props: { src: '/media/1' } });
            s.h = y + 400;
          });
          edSelect(id);
          return { id, handles: [...document.querySelectorAll(`.ed-box[data-el="${id}"] .ed-h`)].map((h) => h.dataset.dir) };
        });
        check(`${width}: every corner and side has a handle`,
          rz.handles.length === 8 && ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].every((d) => rz.handles.includes(d)),
          JSON.stringify(rz.handles));
        const hSize = await page.evaluate((i) => {
          const h = document.querySelector(`.ed-box[data-el="${i}"] .ed-h-nw`);
          const r = h.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        }, rz.id);
        check(`${width}: and each is big enough to grab on the glass`,
          hSize.w >= 12 && hSize.h >= 12, JSON.stringify(hSize));

        /* ONE FRESH ELEMENT PER DIRECTION, and a modest drag.

           Dragging the same element four times in a row is how this first went:
           at 390px the viewport clamps a pointer pushed past its right edge, so
           the east drag was silently truncated, every later `before` inherited a
           size nobody intended, and the west drag reported the element getting
           NARROWER. The behaviour was right; the test was standing on its own
           earlier steps. Each direction now starts clean, near the middle,
           where 30px of travel is never clamped. */
        const dragHandle = async (dir, sdx, sdy) => {
          const id = await page.evaluate((d) => {
            const i = SiteDocStore.newId('rz' + d);
            edApply((doc) => {
              const p = SiteDocStore.findPage(doc, edPageId);
              const s = p.sections[0];
              const y = (Number(s.h) || 0) + 80;
              s.els.push({ id: i, type: 'box', x: 400, y, w: 300, h: 200, props: { bg: '6366F1' } });
              s.h = y + 340;
            });
            edSelect(i);
            return i;
          }, dir);
          await page.waitForTimeout(800);
          await page.evaluate((a) => {
            const h = document.querySelector(`.ed-box[data-el="${a.i}"] .ed-h-${a.d}`);
            if (h) h.scrollIntoView({ block: 'center' });
          }, { i: id, d: dir });
          await page.waitForTimeout(300);
          const at = await page.evaluate((a) => {
            const h = document.querySelector(`.ed-box[data-el="${a.i}"] .ed-h-${a.d}`);
            if (!h) return null;
            const r = h.getBoundingClientRect();
            const x = r.left + r.width / 2, y = r.top + r.height / 2;
            const top = document.elementFromPoint(x, y);
            const el = SiteDocStore.findElement(edStore.getDoc(), a.i).el;
            return { x, y, onTarget: !!(top && top.dataset && top.dataset.dir === a.d),
              got: top && top.dataset ? top.dataset.dir : null,
              before: { x: el.x, y: el.y, w: el.w, h: el.h } };
          }, { i: id, d: dir });
          if (!at) return null;
          if (!at.onTarget) return { before: at.before, after: at.before, missed: at.got };
          // Stay inside the window at both widths — a clamped pointer is a
          // shorter drag than the one asked for, silently.
          const vw = width, vh = 900, M = 12;
          const tx = Math.max(M, Math.min(vw - M, at.x + sdx));
          const ty = Math.max(M, Math.min(vh - M, at.y + sdy));
          await page.mouse.move(at.x, at.y);
          await page.mouse.down();
          await page.mouse.move(tx, ty, { steps: 8 });
          await page.mouse.up();
          await page.waitForTimeout(300);
          const after = await page.evaluate((i) => {
            const el = SiteDocStore.findElement(edStore.getDoc(), i).el;
            return { x: el.x, y: el.y, w: el.w, h: el.h };
          }, id);
          return { before: at.before, after, moved: { dx: tx - at.x, dy: ty - at.y } };
        };

        const east = await dragHandle('e', 30, 0);
        check(`${width}: dragging the east edge widens it and holds the left`,
          east && east.after.w > east.before.w && east.after.x === east.before.x, JSON.stringify(east));
        const west = await dragHandle('w', -30, 0);
        /* THE WHOLE POINT OF MORE THAN ONE HANDLE. A west drag must move the
           origin as well as the size, or it is the east handle with a different
           cursor and the element crawls across the page. */
        check(`${width}: dragging the west edge widens it and moves its left edge`,
          west && west.after.w > west.before.w && west.after.x < west.before.x, JSON.stringify(west));
        const south = await dragHandle('s', 0, 30);
        check(`${width}: dragging the south edge makes it taller`,
          south && south.after.h > south.before.h && south.after.y === south.before.y, JSON.stringify(south));
        const north = await dragHandle('n', 0, -30);
        check(`${width}: dragging the north edge makes it taller upwards`,
          north && north.after.h > north.before.h && north.after.y < north.before.y, JSON.stringify(north));

        /* A VIDEO IS AS BIG AS ITS BOX. It used to take whatever height its
           aspect ratio wanted and hang outside the element entirely. Measured
           against the RENDERED page, not the document. */
        const vidFit = await page.evaluate(async (i) => {
          await new Promise((r) => setTimeout(r, 1300));
          const f = document.getElementById('wcEdFrame');
          const wrap = f.contentDocument.querySelector(`.sd-el[data-el="${i}"]`);
          const v = wrap && wrap.querySelector('video');
          if (!wrap || !v) return null;
          const wr = wrap.getBoundingClientRect(), vr = v.getBoundingClientRect();
          return { wrapH: Math.round(wr.height), vidH: Math.round(vr.height),
            overflowsBy: Math.round(vr.bottom - wr.bottom), fitClass: wrap.className.includes('sd-el--fit'),
            objectFit: getComputedStyle(v).objectFit };
        }, rz.id);
        check(`${width}: the video is contained by its box, not hanging out of it`,
          vidFit && vidFit.overflowsBy <= 1 && vidFit.vidH <= vidFit.wrapH + 1, JSON.stringify(vidFit));
        check(`${width}: it fills the box rather than being letterboxed`,
          vidFit && vidFit.fitClass && vidFit.objectFit === 'cover', JSON.stringify(vidFit));

        /* ── VIDEO PLAYS, IN BOTH PLACES ────────────────────────────────────
           A real clip, recorded by this browser and uploaded through the app's
           own path, then PLAYED. Nothing here is synthetic: a fake byte blob
           would prove the plumbing and nothing about whether a video plays. */
        const clip = await page.evaluate(async () => {
          const c = document.createElement('canvas'); c.width = 160; c.height = 120;
          const g = c.getContext('2d');
          let t = 0; const iv = setInterval(() => { g.fillStyle = `hsl(${(t += 20) % 360},70%,50%)`; g.fillRect(0, 0, 160, 120); }, 50);
          const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
          if (!mime) { clearInterval(iv); return { skip: true }; }
          const rec = new MediaRecorder(c.captureStream(25), { mimeType: mime });
          const chunks = [];
          rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
          rec.start();
          await new Promise((r) => setTimeout(r, 1000));
          await new Promise((r) => { rec.onstop = r; rec.stop(); });
          clearInterval(iv);
          const fd = new FormData();
          fd.append('file', new Blob(chunks, { type: 'video/webm' }), 'clip.webm');
          const res = await fetch('/api/site-media', { method: 'POST', headers: authHeadersNoType(), body: fd });
          const d = await res.json().catch(() => ({}));
          return { status: res.status, url: d.url, mime: d.mime, safe: d.safe };
        });
        if (!clip.skip) {
          check(`${width}: a real video uploads and comes back typed`,
            clip.status === 200 && /^\/media\/\d+$/.test(clip.url || '') && /^video\//.test(clip.mime || ''), JSON.stringify(clip));

          const vidId = await page.evaluate(async (u) => {
            const i = SiteDocStore.newId('vp');
            edApply((d) => {
              const p = SiteDocStore.findPage(d, edPageId);
              const s = p.sections[0];
              const y = (Number(s.h) || 0) + 60;
              // WITH A LABEL. Without one this bug is invisible: the label is
              // what pushed the control bar out of the clipped box.
              s.els.push({ id: i, type: 'video', x: 60, y, w: 480, h: 300, props: { src: u.url, srcType: u.mime, label: 'About me' } });
              s.h = y + 400;
            });
            edSelect(i);
            await new Promise((r) => setTimeout(r, 1800));
            return i;
          }, clip);

          const geom = await page.evaluate((i) => {
            const f = document.getElementById('wcEdFrame');
            const wrap = f.contentDocument.querySelector(`.sd-el[data-el="${i}"]`);
            const v = wrap && wrap.querySelector('video');
            if (!v) return null;
            const wr = wrap.getBoundingClientRect(), vr = v.getBoundingClientRect();
            return { wrapH: Math.round(wr.height), vidH: Math.round(vr.height),
              pastBottom: Math.round(vr.bottom - wr.bottom),
              type: (v.querySelector('source') || {}).getAttribute ? v.querySelector('source').getAttribute('type') : null,
              inline: v.hasAttribute('playsinline') };
          }, vidId);
          /* THE ONE THAT MADE THE PLAY BUTTON DEAD. The control bar sits at the
             bottom of the video; with a label above it the video overflowed and
             overflow:hidden cut that strip off. */
          check(`${width}: a labelled video's controls are inside its box`,
            geom && geom.pastBottom <= 1, JSON.stringify(geom));
          check(`${width}: the source is typed and the player stays inline`,
            geom && /^video\//.test(geom.type || '') && geom.inline, JSON.stringify(geom));

          // The overlay covers the canvas, so the video gets its own control.
          const playBtn = await page.evaluate((i) => {
            const b = document.querySelector(`.ed-box[data-el="${i}"] .ed-play`);
            return b ? { present: true, w: Math.round(b.getBoundingClientRect().width) } : { present: false };
          }, vidId);
          check(`${width}: a selected video carries a play control`,
            playBtn.present && playBtn.w >= 24, JSON.stringify(playBtn));

          await page.locator(`.ed-box[data-el="${vidId}"] .ed-play`).click();
          await page.waitForTimeout(1200);
          const playing = await page.evaluate((i) => {
            const f = document.getElementById('wcEdFrame');
            const v = f.contentDocument.querySelector(`.sd-el[data-el="${i}"] video`);
            return v ? { paused: v.paused, t: v.currentTime, ready: v.readyState,
              err: v.error ? v.error.code : null } : null;
          }, vidId);
          /* THE EVIDENCE IS THE PLAYHEAD, not `paused`. The recorded clip is
             about a second long, so by the time this is read it has often
             played to the end and paused itself — which is a video that
             worked, reported as a video that did not. */
          check(`${width}: pressing it actually plays the clip in the editor`,
            playing && playing.t > 0 && playing.ready >= 2 && !playing.err, JSON.stringify(playing));

          // And in preview, where the visitor's own controls are what is used.
          await page.evaluate(() => wcSetView('preview'));
          await page.waitForTimeout(2600);
          const pv = await page.evaluate(async () => {
            const f = document.getElementById('wcPreviewFrame');
            const v = f.contentDocument && f.contentDocument.querySelector('video');
            if (!v) return { found: false };
            let err = null;
            try { await v.play(); } catch (e) { err = e.name; }
            const wrap = v.closest('.sd-el');
            const wr = wrap.getBoundingClientRect(), vr = v.getBoundingClientRect();
            await new Promise((r) => setTimeout(r, 350));
            return { found: true, paused: v.paused, t: v.currentTime, ready: v.readyState, err,
              vErr: v.error ? v.error.code : null,
              pastBottom: Math.round(vr.bottom - wr.bottom) };
          });
          check(`${width}: and plays in preview, the way a visitor sees it`,
            pv.found && pv.t > 0 && pv.ready >= 2 && !pv.vErr, JSON.stringify(pv));
          check(`${width}: with its controls inside the box there too`,
            pv.found && pv.pastBottom <= 1, JSON.stringify(pv));
          await page.evaluate(() => wcSetView('edit'));
          await page.waitForTimeout(600);
        }

        /* ── A BACKGROUND ON ANY BOX ────────────────────────────────────────
           Not just the `box` type — a heading takes one too. */
        const bg = await page.evaluate(async (i) => {
          edSelect(i);
          edSetProp('elbg', '#123456');
          edSetNum('elbgRadius', '18', 0, 400);
          await new Promise((r) => setTimeout(r, 1300));
          const f = document.getElementById('wcEdFrame');
          const wrap = f.contentDocument.querySelector(`.sd-el[data-el="${i}"]`);
          const cs = wrap && getComputedStyle(wrap);
          return cs ? { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius } : null;
        }, rz.id);
        check(`${width}: a background set in the panel reaches the rendered box`,
          bg && bg.bg === 'rgb(18, 52, 86)', JSON.stringify(bg));
        check(`${width}: with its corner radius`, bg && bg.radius === '18px', JSON.stringify(bg));

        /* ── SPLITTING A MULTI-BOX ELEMENT ──────────────────────────────────
           Templates ship pre-split now, so this is the route for a site built
           before that. Driven through the panel button, not the function. */
        const split = await page.evaluate(async () => {
          const id = SiteDocStore.newId('gal');
          edApply((d) => {
            const p = SiteDocStore.findPage(d, edPageId);
            const s = p.sections[0];
            const y = (Number(s.h) || 0) + 60;
            s.els.push({ id, type: 'gallery', x: 80, y, w: 1040, h: 380, props: { layout: 'grid', cols: 3, gap: 20, items: [
              { ph: { from: '8B5CF6', to: 'ec4899' }, title: 'Neon Nights' },
              { ph: { from: 'ec4899', to: 'f59e0b' }, title: 'Supercut' },
              { ph: { from: '6366F1', to: '8B5CF6' }, title: 'Afterglow' },
            ] } });
            s.h = y + 460;
          });
          edSelect(id);
          edSetGear(true);
          await new Promise((r) => setTimeout(r, 300));
          const btn = document.querySelector('#wcEdInspector button[onclick*="edSplitSel"]');
          const before = document.querySelectorAll('.ed-box').length;
          if (btn) btn.click();
          await new Promise((r) => setTimeout(r, 1400));
          const boxes = [...document.querySelectorAll('.ed-box')].map((b) => b.dataset.el);
          const f = document.getElementById('wcEdFrame');
          const still = !!f.contentDocument.querySelector(`.sd-el[data-el="${id}"]`);
          return { offered: !!btn, before, after: boxes.length, galleryGone: !boxes.includes(id), stillRendered: still, sel: edSel };
        });
        check(`${width}: a multi-picture element offers to split`, split.offered, JSON.stringify(split));
        check(`${width}: splitting turns one box into three`,
          split.after === split.before + 2 && split.galleryGone, JSON.stringify(split));
        check(`${width}: and the split boxes are still on the page, not vanished`,
          !split.stillRendered && split.sel, JSON.stringify(split));

        // Each one is now separately selectable — the whole point.
        const indep = await page.evaluate(() => {
          const ids = [...document.querySelectorAll('.ed-box')].map((b) => b.dataset.el).filter((x) => /^e/.test(x));
          const a = ids[ids.length - 3], b = ids[ids.length - 2];
          edSelect(a); const selA = edSel;
          edSelect(b); const selB = edSel;
          return { a, b, selA, selB, distinct: a !== b && selA === a && selB === b };
        });
        check(`${width}: each split box selects on its own`, indep.distinct, JSON.stringify(indep));

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

      /* ── UPLOAD, PREVIEW, SAVE, HEADER ──────────────────────────────────
         A real file through the real picker, all the way to a decoded image in
         the canvas. Every media upload in the Website Creator had been failing
         with a 400 for months — `authHeaders()` declares application/json,
         which overwrites the multipart Content-Type and makes express.json()
         choke on the body before the route is reached — and the only way to
         see that is to send a file. */
      const upTarget = await page.evaluate(() => {
        const id = SiteDocStore.newId('up');
        edApply((d) => {
          const p = SiteDocStore.findPage(d, edPageId);
          const s = p.sections[0];
          const y = (Number(s.h) || 0) + 40;
          s.els.push({ id, type: 'image', x: 40, y, w: 300, h: 200, props: {} });
          s.h = y + 260;
        });
        edSelect(id);
        return id;
      });
      await page.waitForTimeout(900);
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
        page.evaluate(() => edPickMedia('image')),
      ]);
      check(`${width}: choosing a photo opens a file picker`, !!chooser);
      if (chooser) {
        await chooser.setFiles(PIXEL);
        /* Scroll it into view first. The rendered page marks images
           `loading="lazy"`, so one far below the fold is never fetched and
           `naturalWidth` stays 0 — which says nothing about the upload. The
           canvas is much taller by this point in the run than it used to be. */
        await page.waitForTimeout(900);
        await page.evaluate((i) => {
          const f = document.getElementById('wcEdFrame');
          const n = f && f.contentDocument && f.contentDocument.querySelector(`.sd-el[data-el="${i}"]`);
          if (n) n.scrollIntoView({ block: 'center' });
          const box = document.querySelector(`.ed-box[data-el="${i}"]`);
          if (box) box.scrollIntoView({ block: 'center' });
        }, upTarget);
        await page.waitForFunction((i) => {
          const f = document.getElementById('wcEdFrame');
          const n = f && f.contentDocument && f.contentDocument.querySelector(`.sd-el[data-el="${i}"] img`);
          return !!(n && n.naturalWidth > 0);
        }, upTarget, { timeout: 12000 }).catch(() => {});
        const up = await page.evaluate((i) => {
          const hit = SiteDocStore.findElement(edStore.getDoc(), i);
          const f = document.getElementById('wcEdFrame');
          const n = f.contentDocument.querySelector(`.sd-el[data-el="${i}"] img`);
          return {
            src: hit ? (hit.el.props || {}).src : null,
            inCanvas: n ? n.getAttribute('src') : null,
            decoded: n ? n.naturalWidth : 0,
            toast: (document.querySelector('.toast.show, #toast.show, .toast') || {}).textContent || '',
          };
        }, upTarget);
        check(`${width}: the upload reaches the server and comes back with a URL`,
          /^\/media\/\d+$/.test(up.src || ''), JSON.stringify(up));
        check(`${width}: and the photo is IN the canvas, decoded`,
          up.inCanvas === up.src && up.decoded > 0, JSON.stringify(up));
        check(`${width}: with a toast saying so`, /uploaded/i.test(up.toast), JSON.stringify(up));

        /* ── THE SAME PHOTO, AT PHONE WIDTH ─────────────────────────────────
           A photo's height must come from the BOX it was drawn in, at every
           width. The mobile stylesheet used to force `height:auto!important`
           on it — the only rule in the sheet that made a phone size a photo
           from the FILE instead — so a 1×1 test pixel in a 310px box was 310px
           on a laptop and whatever its own aspect said on a phone.

           Rendered through the real published-page endpoint into a 390px
           frame, and measured against the height the element is DRAWN at
           rather than against a constant, so this keeps meaning something if
           the template changes. */
        const mob = await page.evaluate(async (i) => {
          const hit = SiteDocStore.findElement(edStore.getDoc(), i);
          const drawn = hit ? Number(hit.el.h) || 0 : 0;
          const r = await fetch('/api/personal-site/preview', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ text: 'Test Person\nyou@example.com\n\nSUMMARY\nA summary.', name: 'Test', config: edStore.getDoc() }),
          });
          if (!r.ok) return { err: r.status };
          const html = await r.text();
          const f = document.createElement('iframe');
          f.style.cssText = 'position:fixed;left:-9999px;top:0;width:390px;height:900px;border:0;';
          document.body.appendChild(f);
          f.srcdoc = html;
          await new Promise((res) => { f.onload = res; setTimeout(res, 4000); });
          await new Promise((res) => setTimeout(res, 900));
          const d = f.contentDocument;
          const img = [...d.querySelectorAll('.sd-img')].find((n) => (n.getAttribute('src') || '').startsWith('/media/'));
          const el = img && img.closest('.sd-el');
          const out = img
            ? { drawn, vw: d.documentElement.clientWidth,
                elH: Math.round(el.getBoundingClientRect().height),
                imgH: Math.round(img.getBoundingClientRect().height),
                imgW: Math.round(img.getBoundingClientRect().width),
                disp: getComputedStyle(el).display,
                fromFile: getComputedStyle(img).height === 'auto' }
            : { drawn, none: true, imgs: d.querySelectorAll('.sd-img').length };
          f.remove();
          return out;
        }, upTarget);
        check(`${width}: the photo is on the published page at phone width`,
          mob && !mob.err && !mob.none && mob.imgW > 300, JSON.stringify(mob));
        check(`${width}: and takes the height of the box, not of the file`,
          mob && mob.drawn > 0 && Math.abs(mob.imgH - mob.drawn) <= 2 && Math.abs(mob.elH - mob.drawn) <= 2,
          JSON.stringify(mob));
      }

      /* ── PREVIEW: THE DEVICE TOGGLE, PRESSED ────────────────────────────
         By CLICKING the buttons, not by calling edSetDevice — the report was
         "tapping them does nothing", and a function that works when called
         directly is not evidence about a button.

         And measured on the LAYOUT WIDTH OF THE PAGE INSIDE, not on the frame.
         That distinction is the whole bug: the frame used to be sized
         `mobile ? Math.min(390, avail) : avail`, so on a phone (stage 334px)
         both branches produced 334 and the "desktop" preview was already being
         rendered at phone width. The highlight moved, the corner radius
         changed, the document was identical.

         The previous version of this check carved out exactly that case —
         `const roomForPhone = pvDesk.w > 400` — and excused a dead toggle at
         390px as correct. It is not correct, and the carve-out is why the bug
         shipped. What matters is that the two views lay the page out at
         different widths at EVERY width; how big the picture of it is on
         screen is a separate question. */
      await page.evaluate(() => { edSetDevice('desktop'); wcSetView('preview'); });
      await page.waitForTimeout(1600);
      const pvShot = () => {
        const f = document.getElementById('wcPreviewFrame');
        const box = document.getElementById('wcPreviewBox');
        const b = document.getElementById('cvBackToEdit');
        let inner = -1;
        try { inner = f.contentDocument.documentElement.clientWidth; } catch (_) {}
        return {
          inner, w: Math.round(f.getBoundingClientRect().width),
          boxW: box ? Math.round(box.getBoundingClientRect().width) : -1,
          stage: document.getElementById('wcEdStage').clientWidth,
          back: b && b.offsetWidth > 0,
          prevBtn: (document.getElementById('cvPreviewBtn') || {}).offsetWidth,
          on: document.getElementById('wcEdMobBtn').classList.contains('is-on'),
        };
      };
      const pvDesk = await page.evaluate(pvShot);
      await page.click('#wcEdMobBtn');
      await page.waitForTimeout(1600);
      const pvMob = await page.evaluate(pvShot);

      check(`${width}: pressing the phone button changes what the preview renders`,
        pvMob.inner === 390 && pvDesk.inner > 390 && pvMob.inner !== pvDesk.inner,
        JSON.stringify({ pvDesk, pvMob }));
      /* A desktop preview must be a DESKTOP layout — wide enough that the
         site's own phone stylesheet (max-width:820px) is not the one in force.
         Otherwise both buttons show a phone and only one of them admits it. */
      check(`${width}: and the desktop preview really is a desktop layout`,
        pvDesk.inner > 820, JSON.stringify(pvDesk));
      // Whatever the layout width, the picture of it fits the stage.
      check(`${width}: with both views fitted to the stage, not overflowing it`,
        pvMob.boxW <= pvMob.stage && pvDesk.boxW <= pvDesk.stage,
        JSON.stringify({ pvDesk, pvMob }));
      check(`${width}: and the highlight moves with it`, pvMob.on, JSON.stringify(pvMob));
      check(`${width}: preview offers a visible way back to editing`, pvDesk.back, JSON.stringify(pvDesk));
      check(`${width}: and hides the Preview button while previewing`, pvDesk.prevBtn === 0, JSON.stringify(pvDesk));

      await page.evaluate(() => { edSetDevice('desktop'); wcSetView('edit'); });
      await page.waitForTimeout(600);
      const backIn = await page.evaluate(() => ({
        canvas: document.querySelector('#wcEdStage .cv-canvasbox').style.display,
        preview: document.getElementById('wcPreview').style.display,
        back: (document.getElementById('cvBackToEdit') || {}).style.display,
      }));
      check(`${width}: Back to editing returns to the canvas`,
        backIn.canvas !== 'none' && backIn.preview === 'none' && backIn.back === 'none', JSON.stringify(backIn));

      // SAVE saves and STAYS. The header no longer carries a bare page name.
      const header = await page.evaluate(() => {
        const t = document.getElementById('cvDocTitle');
        const sv = document.getElementById('cvSaveBtn');
        return { titleOnScreen: !!(t && t.offsetWidth > 0), titleText: t ? t.textContent : null,
          titleGone: !t,
          saveText: sv ? sv.textContent.trim() : null, doneGone: !document.getElementById('cvDoneBtn') };
      });
      check(`${width}: the page name is gone from the header`,
        header.titleGone, JSON.stringify(header));
      check(`${width}: the button says Save`, /save/i.test(header.saveText || ''), JSON.stringify(header));
      const nSave = posts.length;
      await page.evaluate(() => wcSaveNow());
      await page.waitForTimeout(900);
      const afterSave = await page.evaluate(() => ({
        tab: (document.querySelector('.tab-content.active') || {}).id,
        shell: (document.getElementById('cvShell') || {}).style.display,
      }));
      check(`${width}: Save writes to the server`, posts.length > nSave, `${nSave} -> ${posts.length}`);
      check(`${width}: and leaves you in the editor`,
        afterSave.tab === 'panel-website' && afterSave.shell !== 'none', JSON.stringify(afterSave));

      // Leaving is still possible — the app's own navigation flushes and goes.
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
