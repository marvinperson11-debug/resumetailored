#!/usr/bin/env node
/**
 * Element-library test (V4).
 *
 * The Add Elements palette lives in the editor (app.html) while the elements are
 * drawn by the renderer (server.js). If those drift, a user can drop an element
 * onto the canvas that renders as nothing — the worst kind of bug, because the
 * editor looks fine.
 *
 * This test parses ED_PALETTE straight out of app.html, builds a real site
 * document containing EVERY palette entry with its default props, renders it
 * through the production renderer, and asserts each one produces output.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-elib-'));
const { _renderPersonalSite } = require('../server.js');

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { fails++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── pull ED_PALETTE out of app.html and evaluate it ────────────────────────
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
const start = app.indexOf('const ED_PALETTE = [');
ok('ED_PALETTE found in app.html', start !== -1);
let depth = 0, end = -1;
for (let i = app.indexOf('[', start); i < app.length; i++) {
  if (app[i] === '[') depth++;
  else if (app[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
}
const palette = eval(app.slice(app.indexOf('[', start), end + 1)); // eslint-disable-line no-eval
const specs = palette.flatMap((g) => g.items.map((it) => Object.assign({ group: g.group }, it)));
ok('palette has entries', specs.length > 0, `${specs.length}`);

// ── build one document containing every palette element ────────────────────
const RESUME = 'Alex Morgan\nalex@example.com | NYC\n\nSUMMARY\nOperations leader.\n\nEXPERIENCE\nVP Ops\n• Owned a $40M P&L\n\nSKILLS\nGTM, Org design';

const els = specs.map((s, i) => ({
  id: 'e' + i, type: s.type, x: 40, y: i * 60, w: s.w, h: s.h,
  props: JSON.parse(JSON.stringify(s.props || {})),
}));

const doc = {
  v: 2, lang: 'en', theme: { primary: '6366F1', accent: '8B5CF6' },
  pages: [{
    id: 'home', name: 'Home', slug: 'home', isHome: true,
    sections: [{ id: 's1', h: specs.length * 60 + 400, bg: { type: 'color', value: '#ffffff' }, els }],
  }],
};

const render = (cfg, opts) => _renderPersonalSite(
  {
    subdomain: 'elib', name: 'Alex Morgan', text: RESUME, accent: '8b5cf6',
    primary_hex: '4a1042', hide_contact: 0, config: JSON.stringify(cfg),
  },
  'https://resumetailored.com',
  Object.assign({ indexable: false, footer: '' }, opts || {}),
);
const html = render(doc);
const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1] || '';
const bodyEd = ((render(doc, { editable: true }).match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1] || '');

// Count element WRAPPERS precisely. Note `class="sd-el"` is a prefix of
// `class="sd-elabel"`, so a naive /class="sd-el/ match silently counts labels as
// elements — that flaw once hid a real bug where video/audio rendered nothing.
// Anchor on the quote/space that terminates the class name.
const wrapperRe = /<div class="sd-el(?:"|\s)/g;
const wrapperCount = (body.match(wrapperRe) || []).length;
/* THE RULE: whoever drops an element sees something. For the OWNER that is
   unconditional — an element that renders nothing on the canvas reads as a
   feature that failed. For a VISITOR it is the opposite: an element the owner
   has not filled in yet (a photo slot with no photo, a map with no address,
   social buttons with no handles) must be invisible, because publishing
   "Add an address" on your own portfolio is worse than publishing nothing. */
/* The one exception on the owner's side is an empty PHOTO slot, which was
   deliberately made invisible everywhere: keeping it for the owner was tried
   and reverted, because editing is permanent now and the ellipse came back on
   every visit. Photos are added through the panel, not by clicking a ghost. */
const photoSlots = specs.filter((s) => (s.type === 'image' || s.type === 'imagebox') && !(s.props && s.props.src));
const wrapperCountEd = (bodyEd.match(wrapperRe) || []).length;
ok('every palette entry draws something for the OWNER (bar empty photo slots)',
  wrapperCountEd === specs.length - photoSlots.length,
  `${wrapperCountEd} wrappers for ${specs.length} entries minus ${photoSlots.length} photo slots`);
ok('and that exception really is only the photo slots', photoSlots.length === 2, String(photoSlots.length));

const unfilled = specs.filter((s) => {
  const p = s.props || {};
  if (s.type === 'image' || s.type === 'imagebox') return !p.src;
  if (s.type === 'map') return !p.address;
  if (s.type === 'social') return !(p.items || []).some((i) => i && i.url);
  return false;
});
ok('and nothing half-finished reaches a VISITOR',
  wrapperCount === specs.length - unfilled.length,
  `${wrapperCount} wrappers for ${specs.length} entries minus ${unfilled.length} unfilled`);
ok('the unfilled ones are exactly the slots with nothing in them yet',
  unfilled.length === 5, String(unfilled.length));

// Render each element on its own so an empty render can be attributed exactly.
specs.forEach((s) => {
  const one = {
    v: 2, lang: 'en', theme: { primary: '6366F1', accent: '8B5CF6' },
    pages: [{
      id: 'home', name: 'Home', slug: 'home', isHome: true,
      sections: [{ id: 's1', h: 600, bg: { type: 'color', value: '#ffffff' },
        els: [{ id: 'only', type: s.type, x: 40, y: 40, w: s.w, h: s.h, props: JSON.parse(JSON.stringify(s.props || {})) }] }],
    }],
  };
  // Editable: this asks "would the owner see it", which is the question that
  // matters when they have just dragged it onto the canvas.
  const h1 = render(one, { editable: true });
  const b1 = (h1.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1] || '';
  const rendered = (b1.match(wrapperRe) || []).length === 1;
  // image/imagebox are the deliberate exception: with no photo yet they render
  // NOTHING, for the owner as well as for a visitor, so the page never
  // advertises its own missing pieces. Every other element must draw something,
  // or a user could add one and see nothing.
  const photoSlot = (s.type === 'image' || s.type === 'imagebox') && !(s.props && s.props.src);
  if (photoSlot) {
    ok(`"${s.label}" with no photo yet renders nothing`, !rendered,
      'an empty photo slot was drawn — it should be invisible until a photo is added');
  } else {
    ok(`"${s.group} / ${s.label}" (${s.type}) renders with default props`, rendered,
      'element produced no output — a user could drop this and see nothing');
  }
});

// A few element-specific sanity checks that catch silent misconfiguration.
ok('gallery layouts all present', /sd-gal--grid/.test(body) && /sd-gal--masonry/.test(body) && /sd-gal--slider/.test(body));
ok('media elements never autoplay', !/autoplay/i.test(body));
ok('résumé element renders the résumé', /sd-resume/.test(body) && /Alex Morgan/.test(body));
ok('placeholder art renders for empty image slots', /sd-ph/.test(body));
ok('both form modes render', /Send me the resume|Send/.test(body) && /sg-lead-form/.test(body));

try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (_) {}
console.log(`\n${fails ? 'FAILED' : 'ALL PASS'} (${fails} failure${fails === 1 ? '' : 's'})`);
process.exit(fails ? 1 : 0);
