#!/usr/bin/env node
/**
 * EVERY TEMPLATE, AT PHONE WIDTH — clipping, overflow and missing content.
 *
 * The phone no longer restacks a site; it lays the page out at SD_MOBILE_W and
 * scales it to the screen. That is one rule applied to twelve different
 * designs, so "it works" has to mean "it works for all twelve" rather than for
 * whichever one happened to be open.
 *
 * Dependency-free, so it runs in the `test/*.js` loop: it renders the HTML and
 * reads it, rather than driving a browser. What a browser adds — real geometry
 * — is covered separately in test/browser/editor.js; what matters here is that
 * every template survives the SAME transformation, and that is visible in the
 * markup the server produces.
 *
 * Usage: node test/templates-mobile.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-tplm-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { _renderPersonalSite } = require('../server.js');
const { templateList, templateDoc } = require('../site-templates.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const RESUME = 'Alex Morgan\nalex@example.com | New York, NY\n\nSUMMARY\nOperations leader.\n\nEXPERIENCE\nVP Operations, Northwind\n• Owned a $40M P&L\n\nSKILLS\nGTM, Org design';

const tpls = templateList();
check('there are templates to check at all', tpls.length >= 12, 'found ' + tpls.length);

for (const t of tpls) {
  const doc = templateDoc(t.id);
  if (!doc) { check(`${t.id}: has a document`, false); continue; }
  const html = _renderPersonalSite(
    { subdomain: 'tpl', name: 'Alex Morgan', text: RESUME, accent: '8b5cf6', primary_hex: '4a1042', hide_contact: 0, config: JSON.stringify(doc) },
    'https://resumetailored.com', { indexable: true, footer: '' },
  );

  /* THE SCALING WRAPPER MUST WRAP EVERYTHING. A section emitted outside
     .sd-page would be laid out at the phone's own width while its neighbours
     were laid out at 1000 and scaled — the two would not line up, and only on
     a phone. */
  const vp = html.indexOf('<div class="sd-vp"><div class="sd-page">');
  const firstSec = html.indexOf('<section class="sd-sec');
  const lastSec = html.lastIndexOf('<section class="sd-sec');
  const wrapClose = html.indexOf('</div></div>\n  <script>');
  const secs = (html.match(/<section class="sd-sec/g) || []).length;
  /* By POSITION, not by slicing to the first `</div></div>` — the sections are
     full of nested divs and that landed inside the first element on the page,
     reporting 1 section of 4 for a document that was perfectly well wrapped. */
  check(`${t.id}: every section is inside the scaling wrapper`,
    vp >= 0 && secs > 0 && vp < firstSec && wrapClose > lastSec,
    `wrapper@${vp} firstSec@${firstSec} lastSec@${lastSec} close@${wrapClose} sections=${secs}`);

  /* NOTHING IS DROPPED ON A PHONE. The old behaviour hid nothing either, but
     it is the specific fear here — a layout that "fits" because content went
     missing would satisfy every geometric check. */
  const els = (html.match(/<div class="sd-el/g) || []).length;
  check(`${t.id}: renders its elements`, els > 0, 'elements=' + els);
  /* On the ELEMENT's class attribute. Matching the bare string counted the
     stylesheet's own `.sd-el--mhide{display:none!important}` rule as a hidden
     element and failed every template that renders correctly. */
  const hidden = (html.match(/<div class="sd-el[^"]*sd-el--mhide/g) || []).length;
  const meantToHide = (doc.pages || []).reduce((a, p) => a + (p.sections || []).reduce((b, s) =>
    b + (s.els || []).filter((e) => e && (e.mhide || (e.mobile && e.mobile.hidden))).length, 0), 0);
  check(`${t.id}: hides nothing on a phone that it shows on a desktop`,
    hidden === meantToHide, `hidden=${hidden} meantToHide=${meantToHide}`);

  /* Each element carries a percentage left/width, which is what keeps two
     things side by side at any width. A pixel left would be a phone-only
     misplacement — right on a 1200px desktop and wrong everywhere else. */
  const pxLeft = (html.match(/<div class="sd-el[^"]*"[^>]*style="left:\d+px/g) || []).length;
  check(`${t.id}: positions elements proportionally, not in fixed pixels`, pxLeft === 0, 'px-positioned=' + pxLeft);

  // No leftover stacking rule could reach this template's page.
  check(`${t.id}: carries no rule that would restack it on a phone`,
    !/position:static!important/.test(html) && !/\.sd-el\{[^}]*width:100%!important/.test(html));
}

/* The one number the whole scheme hangs on, asserted once rather than per
   template: change it and every published phone page changes with it. */
const one = _renderPersonalSite(
  { subdomain: 'tpl', name: 'A', text: RESUME, accent: '8b5cf6', primary_hex: '4a1042', hide_contact: 0, config: JSON.stringify(templateDoc(tpls[0].id)) },
  'https://resumetailored.com', { indexable: true, footer: '' });
check('the design width is stated once and used by both the CSS and the script',
  /\.sd-page\{width:1000px;/.test(one) && /var W=1000,/.test(one));
/* A hairline is 1px because it is meant to be a hairline; scaled to 0.39 it is
   drawn faintly or not at all. */
check('hairlines keep their thickness through the scale',
  /\.sd-divider\{border-top-width:calc\(1px \/ var\(--sdk,1\)\);\}/.test(one));

if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
process.exit(0);
