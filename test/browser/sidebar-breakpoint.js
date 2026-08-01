#!/usr/bin/env node
/**
 * THE APP SIDEBAR AND THE EDITOR SHELL, AT EVERY WIDTH — never overlapping.
 *
 * `.cv-shell` (the Website Creator's full-screen editor) offsets itself past
 * the app's own left sidebar, activated by a media query. `.sidebar`
 * (style.css) collapses from a real 240px grid column into a horizontal bar
 * at its OWN, separately-authored media query. These two breakpoints used to
 * be different numbers (981px vs 900px) with no reasoning tying them
 * together, so in the 81px window between them the sidebar was still a real
 * column and the shell had not yet been pushed past it — the editor's own
 * rail rendered directly under the app's sidebar. Reported directly: "the
 * sidebar is cut off, tucking behind the canvas."
 *
 * A second, distinct bug lived in the SAME rule: the shell's offset was a
 * flat 240px, which only holds while `.dashboard` starts at the viewport's
 * left edge. `.dashboard` is `max-width:1600px;margin:0 auto`, so past
 * 1600px wide (a Mac external display, easily) it centers and `.sidebar`'s
 * real x position moves right with it — at 1920px it sits at x=160..400, not
 * x=0..240. A flat 240px shell then painted its own opaque background over
 * the last 64-240px of the sidebar, hiding the FREE/PRO badges and the tail
 * of every label — reported as "the sidebar text is cut off on my Mac" (a
 * wide/external display), distinct from the narrow 901-980px case above
 * (that one is an empty gap; this one is real content hidden under the
 * shell). Fixed with `max(240px, calc((100vw - 1600px) / 2 + 240px))`,
 * which reproduces `.dashboard`'s own centering math instead of assuming
 * `.sidebar` starts at x=0.
 *
 * Not a source-level regex — real geometry, at every width either side of
 * both breakpoints and up through a 2560px external display, because a
 * matching NUMBER in the CSS proves the rule was written correctly, not that
 * the browser actually lays it out that way.
 *
 * Usage: node test/browser/sidebar-breakpoint.js
 */
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-sbbp-'));
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
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('m@x.com', 'm', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokM', 'm@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('m@x.com', 'cM');

let failures = 0;
const check = (n, c, d) => { if (c) console.log('PASS  ' + n); else { failures++; console.error('FAIL  ' + n + (d ? ' — ' + d : '')); } };

const server = app.listen(0, async () => {
  const B = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROME_PATH || null;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});

  // Either side of BOTH breakpoints (900px), plus the old, wrong one (981px)
  // that used to leave a real gap, plus widths either side of .dashboard's
  // own 1600px centering threshold, up through a 2560px external display —
  // where the sidebar itself is no longer flush with the viewport's left
  // edge, so a flat 240px offset used to paint over the sidebar's tail.
  for (const w of [880, 900, 901, 940, 980, 981, 1000, 1600, 1601, 1728, 1920, 2560]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
    await ctx.route('**/*', (r) => {
      const u = r.request().url();
      return /^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(u) ? r.continue() : r.abort();
    });
    const page = await ctx.newPage();
    await page.addInitScript((tok) => {
      if (window.top !== window.self) return;
      localStorage.setItem('rt_token', tok.token);
      localStorage.setItem('rt_email', tok.email);
      localStorage.setItem('rt_username', 'm');
    }, { token: 'tokM', email: 'm@x.com' });
    await page.goto(B + '/app.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.showTab === 'function');
    await page.evaluate(() => showTab('website'));
    await page.waitForTimeout(400);

    const info = await page.evaluate(() => {
      const sb = document.querySelector('.sidebar');
      const shell = document.querySelector('.cv-shell');
      const sbR = sb ? sb.getBoundingClientRect() : null;
      const shR = shell ? shell.getBoundingClientRect() : null;
      // A collapsed (horizontal-bar) sidebar spans (close to) the full
      // viewport width; a real left-column sidebar is a fixed 240px wide,
      // wherever `.dashboard`'s own centering has placed it on screen.
      const isColumn = sbR && Math.round(sbR.width) === 240;
      return {
        sidebarX: sbR ? Math.round(sbR.x) : null,
        sidebarRight: sbR ? Math.round(sbR.x + sbR.width) : null,
        isColumn,
        shellLeft: shR ? Math.round(shR.x) : null,
      };
    });

    if (info.isColumn) {
      check(`${w}px: the sidebar is a real 240px column (at x=${info.sidebarX}), and the shell is pushed past its right edge`,
        info.shellLeft === info.sidebarRight, `sidebar right=${info.sidebarRight} shell left=${info.shellLeft}`);
    } else {
      check(`${w}px: the sidebar is the collapsed horizontal bar, so the shell needs no offset`,
        info.shellLeft === 0, `sidebar right=${info.sidebarRight} shell left=${info.shellLeft}`);
    }
    await ctx.close();
  }

  await browser.close();
  server.close();
  if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
  console.log('\nALL PASS (0 failures)');
  process.exit(0);
});
