#!/usr/bin/env node
/**
 * VIBES — re-skin without losing anything.
 *
 * A vibe changes how a site looks. It must never change what the site SAYS.
 * The whole reason "one click = done" is safe to offer a beginner is that
 * trying a vibe cannot cost them anything, so that is what this file checks:
 * structure, copy and uploaded media come out the other side untouched.
 *
 * The second thing it checks is readability. Five of the vibes put text on a
 * full-bleed photograph. If a heading keeps a #ffffff colour from a dark vibe
 * and lands on a light one, it disappears — that is the single most likely way
 * this breaks, and it breaks silently.
 *
 * Usage: node test/vibes.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-vibe-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';

const V = require('../public/site-vibes.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const DOC = () => ({
  v: 2, lang: 'en',
  theme: { primary: '6366F1', accent: '8B5CF6', ink: '0f172a', paper: 'ffffff', muted: '64748b' },
  pages: [{
    id: 'home', name: 'Home', slug: 'home', isHome: true,
    seo: { title: 'Maya Chen', description: 'Product manager' },
    sections: [
      {
        id: 'hero', h: 500, bg: { type: 'color', value: '#ffffff' },
        els: [
          { id: 'n', type: 'nav', x: 80, y: 30, w: 900, h: 40, props: {} },
          { id: 'h', type: 'heading', x: 80, y: 150, w: 700, h: 90, props: { text: 'Maya Chen', color: '#ffffff' } },
          { id: 'p', type: 'paragraph', x: 80, y: 260, w: 560, h: 70, props: { text: 'Eight years shipping data products.' } },
          { id: 'img', type: 'image', x: 820, y: 140, w: 280, h: 280, props: { src: '/media/headshot-42' } },
          { id: 'brand', type: 'subheading', x: 80, y: 360, w: 400, h: 34, props: { text: 'On brand', color: '#ff6600', lockColor: true } },
        ],
      },
      {
        id: 'work', h: 420, bg: { type: 'color', value: '#f8fafc' },
        els: [
          { id: 'wh', type: 'subheading', x: 80, y: 40, w: 400, h: 34, props: { text: 'Experience' } },
          { id: 'r', type: 'resume', x: 80, y: 100, w: 1040, h: 280, props: {} },
        ],
      },
    ],
  }],
});

// ── The catalogue ───────────────────────────────────────────────────────────
const list = V.list();
check('ten vibes are offered', list.length === 10, String(list.length));
check('five are clean, five are photographic',
  list.filter(v => v.kind === 'clean').length === 5 && list.filter(v => v.kind === 'photo').length === 5);
check('every vibe has a name and a swatch',
  list.every(v => v.name && Array.isArray(v.swatch) && v.swatch.length === 2));
check('the five named photographic vibes exist',
  ['sunset', 'forest', 'city', 'ocean', 'mountain'].every(id => {
    const v = V.get(id); return v && v.kind === 'photo' && /^\/vibes\/\w+\.jpg$/.test(v.hero.value);
  }));
check('the five named clean vibes exist',
  ['calm', 'bright', 'polished', 'dark', 'colorful'].every(id => {
    const v = V.get(id); return v && v.kind === 'clean';
  }));

// Every photographic vibe's file must actually be in the repo, or the hero
// renders as a blank band on a live site.
for (const v of V.VIBES.filter(x => x.kind === 'photo')) {
  const f = path.join(__dirname, '..', 'public', v.hero.value);
  let ok = false, kb = 0;
  try { const st = fs.statSync(f); ok = st.size > 1024; kb = Math.round(st.size / 1024); } catch (_) {}
  check(`vibe "${v.id}" ships its photo`, ok, f);
  // A hero background is the first thing a visitor downloads, often on a phone.
  check(`vibe "${v.id}" photo is a sane size (${kb}KB)`, kb > 0 && kb < 600, `${kb}KB`);
}
check('photo provenance is recorded',
  fs.existsSync(path.join(__dirname, '..', 'public', 'vibes', 'CREDITS.md')));

// ── THE GUARANTEE: a re-skin loses nothing ──────────────────────────────────
const before = DOC();
const words = JSON.stringify(before.pages[0].sections.map(s => s.els.map(e => (e.props || {}).text || '')));
const structure = before.pages[0].sections.map(s => ({ id: s.id, h: s.h, ids: s.els.map(e => e.id) }));

for (const v of list) {
  const d = V.applyVibe(DOC(), v.id, 0);
  const gotWords = JSON.stringify(d.pages[0].sections.map(s => s.els.map(e => (e.props || {}).text || '')));
  check(`vibe "${v.id}" keeps every word`, gotWords === words);
  const gotStructure = d.pages[0].sections.map(s => ({ id: s.id, h: s.h, ids: s.els.map(e => e.id) }));
  check(`vibe "${v.id}" keeps every section and element`,
    JSON.stringify(gotStructure) === JSON.stringify(structure));
  const img = d.pages[0].sections[0].els.find(e => e.id === 'img');
  check(`vibe "${v.id}" keeps the uploaded photo`, img && img.props.src === '/media/headshot-42');
  const brand = d.pages[0].sections[0].els.find(e => e.id === 'brand');
  check(`vibe "${v.id}" respects a deliberately chosen colour`, brand && brand.props.color === '#ff6600');
  check(`vibe "${v.id}" is recorded on the document`, d.vibe === v.id);
}

// ── Readability ─────────────────────────────────────────────────────────────
// The heading starts white. On a light vibe it must stop being white, or it
// vanishes; on a dark one it must stay light.
const light = V.applyVibe(DOC(), 'calm', 0);
const lh = light.pages[0].sections[0].els.find(e => e.id === 'h');
check('a light vibe clears leftover white text', !lh.props.color, String(lh.props.color));

const darkV = V.applyVibe(DOC(), 'dark', 0);
const dh = darkV.pages[0].sections[0].els.find(e => e.id === 'h');
check('a dark vibe forces light text', dh.props.color === '#ffffff', String(dh.props.color));

for (const id of ['sunset', 'forest', 'city', 'ocean', 'mountain']) {
  const d = V.applyVibe(DOC(), id, 0);
  const hero = d.pages[0].sections[0];
  check(`photo vibe "${id}" sets a photo hero`, hero.bg.type === 'image' && hero.bg.value.startsWith('/vibes/'));
  check(`photo vibe "${id}" darkens the photo behind the text`,
    typeof hero.bg.overlay === 'number' && hero.bg.overlay > 0.25);
  const h = hero.els.find(e => e.id === 'h');
  check(`photo vibe "${id}" uses light text on the photo`, h.props.color === '#ffffff');
}

// ── Lighten / darken ────────────────────────────────────────────────────────
check('tone is clamped to a small range', V.clampTone(99) === 2 && V.clampTone(-99) === -2 && V.clampTone('x') === 0);
const dark2 = V.applyVibe(DOC(), 'sunset', 2).pages[0].sections[0].bg.overlay;
const lightm2 = V.applyVibe(DOC(), 'sunset', -2).pages[0].sections[0].bg.overlay;
check('darker means a stronger overlay', dark2 > lightm2, `${dark2} vs ${lightm2}`);
check('even the lightest setting keeps text readable', lightm2 >= 0.28, String(lightm2));
check('tone is remembered on the document', V.applyVibe(DOC(), 'sunset', -1).vibeTone === -1);

// A clean vibe's tone must still produce a background the renderer accepts.
const washed = V.applyVibe(DOC(), 'calm', 2).pages[0].sections[0].bg;
check('a toned clean vibe is still a gradient', washed.type === 'gradient');

// ── Re-skinning is repeatable, not cumulative ───────────────────────────────
// Someone will click through all ten. The tenth must look the same as it would
// have if they had clicked it first.
let chained = DOC();
for (const v of list) chained = V.applyVibe(chained, v.id, 0);
const direct = V.applyVibe(DOC(), list[list.length - 1].id, 0);
check('clicking through every vibe lands where clicking one would',
  JSON.stringify(chained) === JSON.stringify(direct));

// ── It survives the renderer ────────────────────────────────────────────────
const { app } = require('../server.js');
const Database = require('better-sqlite3');
const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('v@x.com', 'vee', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tok', 'v@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('v@x.com', 'c');

const server = app.listen(0, async () => {
  const B = `http://127.0.0.1:${server.address().port}`;
  const AJ = { Authorization: 'Bearer tok', 'Content-Type': 'application/json' };
  const TEXT = 'Maya Chen\nmaya@example.com | Seattle\n\nSUMMARY\nEight years.\n\nSKILLS\nSQL';
  try {
    const cat = await (await fetch(`${B}/api/site-vibes`)).json();
    check('the vibe list is served', Array.isArray(cat.vibes) && cat.vibes.length === 10);

    for (const id of ['sunset', 'calm', 'dark']) {
      const doc = V.applyVibe(DOC(), id, 1);
      await fetch(`${B}/api/personal-site`, {
        method: 'POST', headers: AJ,
        body: JSON.stringify({ subdomain: 'vibe' + id, text: TEXT, name: 'Maya Chen', config: doc, publish: true }),
      });
      const html = await (await fetch(`${B}/site/vibe${id}`)).text();
      const v = V.get(id);
      if (v.kind === 'photo') {
        check(`"${id}" renders the photo`, html.includes(`url('${v.hero.value}')`));
        check(`"${id}" renders the readability overlay`, /background-image:linear-gradient\(rgba\(8,12,22,0\.\d+\)/.test(html));
        check(`"${id}" marks the section for text shadow`, html.includes('<section class="sd-sec sd-sec--photo"'));
      } else {
        check(`"${id}" renders its background`, /background-image:linear-gradient/.test(html) || /background-color/.test(html));
        // The class name also appears in the stylesheet on every page, so this
        // has to look at the section tag rather than the whole document.
        check(`"${id}" is not treated as a photo`, !html.includes('<section class="sd-sec sd-sec--photo"'));
      }
      check(`"${id}" applies its accent colour`, html.includes('--p:#' + v.theme.primary) || html.includes('--p:#' + v.theme.primary.toLowerCase()));
    }

    // The photos must actually be served, or every photographic vibe is a
    // blank band on a live site.
    for (const v of V.VIBES.filter(x => x.kind === 'photo')) {
      const r = await fetch(`${B}${v.hero.value}`);
      check(`${v.hero.value} is served`, r.status === 200 && (r.headers.get('content-type') || '').includes('image'));
    }
  } catch (e) {
    failures++;
    console.error('FAIL  unexpected error —', e && e.stack);
  }

  console.log(`\n${failures ? 'FAILED' : 'ALL PASS'} (${failures} failure${failures === 1 ? '' : 's'})`);
  server.close();
  db.close();
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  process.exit(failures ? 1 : 0);
});
