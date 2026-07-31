#!/usr/bin/env node
/**
 * EVERY TEMPLATE'S HERO, WITH A REAL RÉSUMÉ — no text-on-text, no button-on-text.
 *
 * Deliberately NOT under `test/*.js`: it needs a real browser to know how text
 * actually wraps and how tall it actually renders — the thing this bug lived
 * in. A user's click-through found templates where the hero paragraph (or, in
 * two templates, a decorative badge that unintentionally absorbed it) grew
 * past the fixed-pixel box it was drawn in and landed on top of the CTA
 * button below it, or — for an unusually long job title — the subtitle
 * landed on top of the paragraph below THAT. site-fields.js now caps how much
 * text a template is ever handed (test/site-publish.js covers that without a
 * browser) and site-templates.js widened the gaps that were too tight even
 * for the capped length. This is what proves the combination actually holds
 * up on screen, at both a desktop and a phone width, for a résumé written to
 * stress every one of those fields at once — not the placeholder copy the
 * templates ship with, which is always short enough to never have shown this.
 *
 * Run by hand: `node test/browser/template-overlap.js` (needs playwright-core
 * + a Chromium; see test/browser/editor.js's header for the same setup).
 */
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-tpl-ov-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { _renderPersonalSite } = require('../../server.js');
const { templateList, templateDoc } = require('../../site-templates.js');
const SiteFields = require('../../public/site-fields.js');
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch (_) {
  console.log('SKIP  playwright-core is not installed — `npm i --no-save playwright-core` to run this.');
  process.exit(0);
}

let failures = 0;
const check = (n, c, d) => { if (c) console.log('PASS  ' + n); else { failures++; console.error('FAIL  ' + n + (d ? ' — ' + d : '')); } };

/* Deliberately stresses every field the hero pulls from a résumé at once: an
   unbounded-length job title (deriveFields had no cap on `role` at all before
   this fix) and a full multi-sentence SUMMARY section (the 400-char ceiling
   that existed before this fix, now capped tighter at a word boundary). Real
   words throughout — this has to wrap the way real text wraps, not the way a
   repeated filler character does. */
const RESUME = `Marvin Person Jr
marvin@example.com | Greater Minneapolis-Saint Paul Metropolitan Area

SUMMARY
17+ years of manufacturing experience leading production teams, driving lean initiatives and cutting downtime across multiple plants. Skilled in Six Sigma, root-cause analysis, and cross-functional leadership, with a track record of hitting aggressive throughput targets while keeping safety incidents near zero.

EXPERIENCE
Senior Regional Director of Manufacturing Operations and Continuous Improvement Strategy, Ford Motor Company
- Cut unplanned downtime 22% across three production lines
- Led a team of 45 across two shifts

SKILLS
Lean Manufacturing, Six Sigma, SAP, Team Leadership`;

const OUT = path.join(os.tmpdir(), 'rt-tpl-ov-renders');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const exe = process.env.CHROME_PATH || null;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});

  for (const [w, h, label] of [[1440, 2200, 'desktop'], [390, 2800, 'mobile']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.route('**/*', (route) => {
      const u = route.request().url();
      return (u.startsWith('file:') || u.startsWith('data:')) ? route.continue() : route.abort();
    });

    for (const t of templateList()) {
      const doc = templateDoc(t.id);
      SiteFields.fillFromResume(doc, RESUME);
      const html = _renderPersonalSite(
        { subdomain: 'tpl', name: 'Marvin Person Jr', text: RESUME, accent: '8b5cf6', primary_hex: '4a1042', hide_contact: 0, config: JSON.stringify(doc) },
        'https://resumetailored.com', { indexable: true, footer: '', editable: true },
      );
      const file = path.join(OUT, `${t.id}-${label}.html`);
      fs.writeFileSync(file, html);
      await page.goto('file://' + file);
      await page.waitForTimeout(120);

      const result = await page.evaluate(() => {
        const pageEl = document.querySelector('.sd-page') || document.body;
        let sdk = parseFloat(getComputedStyle(pageEl).getPropertyValue('--sdk'));
        if (!sdk || Number.isNaN(sdk)) sdk = 1;
        const heroSec = document.querySelector('section.sd-sec');
        if (!heroSec) return { overlaps: [], count: 0 };
        // `box` elements are template-authored decorative backgrounds, placed
        // BEHIND text on purpose (a lower z-index) — the Bold template's colour
        // block under its heading is real, checked-in design, not a bug. `nav`
        // is a flex row with its own internal layout the way an element with a
        // single x/y/w/h box was never meant to describe.
        const els = Array.from(heroSec.querySelectorAll(':scope > .sd-inner > .sd-el'))
          .filter((e) => e.getAttribute('data-type') !== 'box' && e.getAttribute('data-type') !== 'nav');
        const info = els.map((e) => {
          const r = e.getBoundingClientRect();
          return {
            type: e.getAttribute('data-type'), text: (e.textContent || '').trim().slice(0, 40),
            y: r.y / sdk, bottom: (r.y + r.height) / sdk, x: r.x / sdk, right: (r.x + r.width) / sdk,
          };
        });
        const overlaps = [];
        for (let i = 0; i < info.length; i++) {
          for (let j = 0; j < info.length; j++) {
            if (i === j) continue;
            const a = info[i], b = info[j];
            if (a.y >= b.y) continue; // report each pair from the higher element once
            const ox = Math.min(a.right, b.right) - Math.max(a.x, b.x);
            const oy = a.bottom - b.y;
            // A few px of shared antialiasing/line-height slop is not a visible
            // collision; this is measuring "text sits on text", not sub-pixel
            // box-model noise.
            if (ox > 4 && oy > 4) overlaps.push(`${a.type} "${a.text}" over ${b.type} "${b.text}" (${Math.round(oy)}px)`);
          }
        }
        return { overlaps, count: info.length };
      });

      check(`${t.id} (${label}): renders a hero with elements to check`, result.count > 0, 'count=' + result.count);
      check(`${t.id} (${label}): no text/button/image overlaps in the hero`,
        result.overlaps.length === 0, result.overlaps.join('; '));
    }
    await page.close();
  }

  await browser.close();
  if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
  console.log('\nALL PASS (0 failures)');
  process.exit(0);
})();
