#!/usr/bin/env node
/**
 * PREVIEW PARITY TEST (Website Builder v2)
 *
 * The v1 Website Creator let the editor preview and the published page drift,
 * because they were different code paths. v2 renders both through the single
 * `_renderSiteDoc` renderer. This test proves it: it publishes a site document,
 * fetches the PUBLIC page and the PREVIEW render of the same document, and
 * requires their <body> content to be byte-identical.
 *
 * <head> is intentionally excluded: the public page is index,follow with a
 * canonical URL while the preview is noindex — those differences are correct.
 * Everything a visitor actually sees lives in <body>.
 *
 * Usage: node test/preview-parity.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-parity-'));
// Hundreds of requests from one IP in a couple of seconds: measure rendering,
// not the rate limiter.
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
const Database = require('better-sqlite3');

const bodyOf = (html) => {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return m ? m[1] : html;
};

// A representative multi-page document exercising most element types.
const DOC = {
  v: 2,
  lang: 'en',
  theme: { primary: '6366F1', accent: '8B5CF6', ink: '0f172a', paper: 'ffffff', muted: '64748b' },
  pages: [
    {
      id: 'home', name: 'Home', slug: 'home', isHome: true,
      seo: { title: 'Jane Rivera — Product Manager', description: 'Portfolio of Jane Rivera.' },
      sections: [
        {
          id: 's1', h: 520, bg: { type: 'gradient', value: 'linear-gradient(135deg,#0f172a,#3b0764)' },
          els: [
            { id: 'n1', type: 'nav', x: 80, y: 30, w: 1040, h: 40 },
            { id: 'h1', type: 'heading', x: 80, y: 160, w: 700, h: 120, props: { text: 'Jane Rivera', color: '#ffffff' } },
            { id: 'p1', type: 'paragraph', x: 80, y: 300, w: 560, h: 80, props: { text: 'Senior Product Manager — data products people actually use.', color: '#cbd5e1' } },
            { id: 'b1', type: 'button', x: 80, y: 400, w: 220, h: 50, props: { text: 'See my work', page: 'work' } },
          ],
        },
        {
          id: 's2', h: 460, bg: { type: 'color', value: '#ffffff' },
          els: [
            { id: 'h2', type: 'subheading', x: 80, y: 50, w: 500, h: 40, props: { text: 'Selected results' } },
            { id: 'cs', type: 'casestudies', x: 80, y: 110, w: 1040, h: 300, props: { items: [{ title: 'Led platform migration', metric: '30%', detail: 'Cut infrastructure cost.' }] } },
          ],
        },
      ],
    },
    {
      id: 'work', name: 'Work', slug: 'work',
      sections: [
        {
          id: 's3', h: 620, bg: { type: 'color', value: '#f8fafc' },
          els: [
            { id: 'n2', type: 'nav', x: 80, y: 30, w: 1040, h: 40 },
            { id: 'g1', type: 'gallery', x: 80, y: 110, w: 1040, h: 420, props: { layout: 'grid', cols: 3, gap: 16, items: [{ src: '/media/1', title: 'Project A', caption: 'Case study' }, { src: '/media/2', title: 'Project B' }] } },
            { id: 'f1', type: 'form', x: 80, y: 540, w: 500, h: 60, props: { mode: 'pdf' } },
          ],
        },
      ],
    },
  ],
};

const RESUME = 'Jane Rivera\njane@example.com | NYC\n\nSUMMARY\nSenior PM with 8 years.\n\nEXPERIENCE\nSenior PM, DataCorp\n• Led migration reducing costs 30%\n\nSKILLS\nSQL, Roadmapping';

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('t@x.com', 't', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tok', 't@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('t@x.com', 'c');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log(`PASS  ${name}`); }
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const server = app.listen(0, async () => {
  const port = server.address().port;
  const B = `http://127.0.0.1:${port}`;
  const AJ = { Authorization: 'Bearer tok', 'Content-Type': 'application/json' };
  const SUB = 'janerivera';

  try {
    const pub = await fetch(`${B}/api/personal-site`, {
      method: 'POST', headers: AJ,
      body: JSON.stringify({ subdomain: SUB, text: RESUME, name: 'Jane Rivera', config: DOC }),
    });
    check('publish site document', pub.status === 200);

    // Parity for every page in the document.
    for (const page of DOC.pages) {
      const slug = page.isHome ? '' : page.slug;
      const publicHtml = await (await fetch(`${B}/site/${SUB}${slug ? '/' + slug : ''}`)).text();
      const previewHtml = await (await fetch(`${B}/api/personal-site/preview`, {
        method: 'POST', headers: AJ,
        body: JSON.stringify({ subdomain: SUB, text: RESUME, name: 'Jane Rivera', config: DOC, page: slug }),
      })).text();

      const a = bodyOf(publicHtml).trim();
      const b = bodyOf(previewHtml).trim();
      let detail = '';
      if (a !== b) {
        const i = [...a].findIndex((ch, idx) => ch !== b[idx]);
        detail = `first difference at char ${i}\n  public : ${JSON.stringify(a.slice(Math.max(0, i - 60), i + 60))}\n  preview: ${JSON.stringify(b.slice(Math.max(0, i - 60), i + 60))}`;
      }
      check(`preview === public body for page "${page.slug}"`, a === b, detail);
    }

    // The document renderer must actually be in use (not the legacy fallback).
    const home = await (await fetch(`${B}/site/${SUB}`)).text();
    check('renders v2 site document (not legacy)', home.includes('sd-sec') && home.includes('sd-inner'));
    check('mobile auto-stacking present', home.includes('@media(max-width:820px)') && home.includes('position:static!important'));
    check('elements emitted in mobile reading order', home.indexOf('Jane Rivera<') < home.indexOf('Senior Product Manager'));
    check('multi-page nav rendered', home.includes('sd-navlink') && home.includes('/site/' + SUB + '/work'));

    // Unknown page 404s rather than silently serving home.
    check('unknown page 404s', (await fetch(`${B}/site/${SUB}/nope`)).status === 404);

    // Per-element mobile overrides (V6) must survive publish and stay identical
    // between preview and the public page — including the generated class names.
    const MDOC = {
      v: 2, lang: 'en', theme: { primary: '6366F1', accent: '8B5CF6' },
      pages: [{
        id: 'home', name: 'Home', slug: 'home', isHome: true,
        sections: [{
          id: 's1', h: 500, bg: { type: 'color', value: '#ffffff' },
          els: [
            { id: 'm1', type: 'heading', x: 80, y: 40, w: 600, h: 90, props: { text: 'First on desktop' }, mobile: { order: 2 } },
            { id: 'm2', type: 'paragraph', x: 80, y: 160, w: 500, h: 80, props: { text: 'Second on desktop' }, mobile: { order: 1, w: 50, align: 'center' } },
            { id: 'm3', type: 'paragraph', x: 80, y: 260, w: 500, h: 80, props: { text: 'Hidden on phones' }, mobile: { hidden: true } },
          ],
        }],
      }],
    };
    await fetch(`${B}/api/personal-site`, {
      method: 'POST', headers: AJ,
      body: JSON.stringify({ subdomain: 'mobileovr', text: RESUME, name: 'Jane', config: MDOC }),
    });
    const mPub = await (await fetch(`${B}/site/mobileovr`)).text();
    const mPubBody = bodyOf(mPub).trim();
    const mPrev = bodyOf(await (await fetch(`${B}/api/personal-site/preview`, {
      method: 'POST', headers: AJ,
      body: JSON.stringify({ subdomain: 'mobileovr', text: RESUME, name: 'Jane', config: MDOC }),
    })).text()).trim();
    check('mobile overrides: preview === public', mPubBody === mPrev);
    check('mobile order restacks the DOM', mPubBody.indexOf('Second on desktop') < mPubBody.indexOf('First on desktop'));
    check('mobile width/align rules emitted', /width:50%!important/.test(mPub) && /text-align:center!important/.test(mPub));
    check('mobile hidden element flagged', /sd-el--mhide/.test(mPubBody));
    check('mobile classes are deterministic (id-derived)', /sd-m-m2/.test(mPubBody));

    // Media slots and card backgrounds must honour the height they were drawn
    // at (the stylesheet's height:100% collapses against an auto-height parent),
    // and mailto:/tel: links must survive the URL guard.
    const RDOC = {
      v: 2, lang: 'en', theme: { primary: '6366F1', accent: '8B5CF6' },
      pages: [{
        id: 'home', name: 'Home', slug: 'home', isHome: true,
        sections: [{
          id: 'only', h: 600, bg: { type: 'color', value: '#ffffff' },
          els: [
            { id: 'r1', type: 'image', x: 80, y: 20, w: 300, h: 340, props: { ph: { from: '6366F1', to: '8B5CF6' } } },
            { id: 'r2', type: 'imagebox', x: 420, y: 20, w: 300, h: 320, props: { ph: { from: '6366F1', to: '8B5CF6' } } },
            { id: 'r3', type: 'box', x: 760, y: 20, w: 300, h: 280, props: { bg: 'f8fafc' } },
            { id: 'r4', type: 'social', x: 80, y: 420, w: 400, h: 44, props: { items: [{ network: 'Email', url: 'mailto:you@example.com' }, { network: 'Phone', url: 'tel:+15551234567' }, { network: 'Bad', url: 'javascript:alert(1)' }] } },
            { id: 'r5', type: 'button', x: 80, y: 500, w: 240, h: 50, props: { text: 'Email me', href: 'mailto:you@example.com' } },
          ],
        }],
      }],
    };
    await fetch(`${B}/api/personal-site`, {
      method: 'POST', headers: AJ,
      body: JSON.stringify({ subdomain: 'renderfix', text: RESUME, name: 'Jane', config: RDOC }),
    });
    const rfx = bodyOf(await (await fetch(`${B}/site/renderfix`)).text());
    check('box honours drawn height', /min-height:280px/.test(rfx));

    /* A photo that has not been added yet shows a VISITOR nothing. It used to
       render a gradient blob reading "YOUR HEADSHOT"; on a phone the hero's
       circle stretched to full width and became an ellipse covering most of
       the first screen. A page that announces its own missing pieces is worse
       than a page without them. */
    check('an empty photo slot is invisible to visitors', !/sd-ph/.test(rfx));
    check('and leaves no empty frame behind', !/sd-ibox/.test(rfx));

    /* It stays while EDITING — the slot has to be clickable for a photo to be
       added to it — and there the old collapse still must not happen: an
       absolutely positioned replaced element with `height:auto` falls back to
       its intrinsic 150px. Capped, because drawing it at full designed height
       is what produced the ellipse. */
    const edrfx = await (await fetch(`${B}/api/personal-site/preview`, {
      method: 'POST', headers: AJ,
      body: JSON.stringify({ subdomain: 'renderfix', text: RESUME, name: 'Jane', config: RDOC, editable: true }),
    })).text();
    // Scoped to the slot's own tag: the element WRAPPER legitimately carries the
    // full designed height, so testing the whole document would pass on the
    // wrapper and prove nothing about the slot.
    const slotTag = (edrfx.match(/<div class="sd-ph sd-ph--slot"[^>]*>/) || [''])[0];
    check('the slot is there while editing', !!slotTag, edrfx.slice(0, 120));
    check('and it never collapses to the intrinsic 150px',
      /min-height:200px/.test(slotTag) && !/min-height:150px/.test(slotTag), slotTag);
    check('but is capped rather than drawn at its full designed height',
      !/min-height:340px/.test(slotTag), slotTag);
    check('mailto: social link rendered', /href="mailto:you@example\.com"/.test(rfx));
    check('tel: social link rendered', /href="tel:\+15551234567"/.test(rfx));
    check('javascript: link still rejected', !/javascript:/i.test(rfx));
    check('mailto: button link rendered', (rfx.match(/href="mailto:you@example\.com"/g) || []).length === 2);
    check('anchor id emitted on section', /<section class="sd-sec" id="only"/.test(rfx));

    // There is exactly one renderer now: a site row without a v2 document gets a
    // placeholder, never a legacy grid/résumé render.
    await fetch(`${B}/api/personal-site`, {
      method: 'POST', headers: AJ,
      body: JSON.stringify({ subdomain: 'nodoc', text: RESUME, name: 'Jane', config: { v: 1, blocks: [{ type: 'heading', colSpan: 12, text: 'Hi' }] } }),
    });
    const nodoc = await (await fetch(`${B}/site/nodoc`)).text();
    check('no v2 document → placeholder, no legacy renderer', nodoc.includes("hasn't been built yet") && !nodoc.includes('site-grid') && !nodoc.includes('sd-sec'));

    // Every starter template must render through the same renderer.
    const { templateList, templateDoc } = require('../site-templates.js');
    const cat = await (await fetch(`${B}/api/site-templates`, { headers: AJ })).json();
    check('template catalogue served', Array.isArray(cat.templates) && cat.templates.length === 12);
    for (const t of templateList()) {
      const html = await (await fetch(`${B}/api/site-templates/${t.id}/preview`, { headers: AJ })).text();
      const body = bodyOf(html);
      check(`template "${t.id}" renders sections+elements`, /class="sd-sec"/.test(body) && /class="sd-el/.test(body));
      // Publishing a template document and previewing it must still match.
      await fetch(`${B}/api/personal-site`, {
        method: 'POST', headers: AJ,
        body: JSON.stringify({ subdomain: 'tpl' + t.id.replace(/[^a-z]/g, ''), text: RESUME, name: 'Alex Morgan', config: templateDoc(t.id) }),
      });
      const sub2 = 'tpl' + t.id.replace(/[^a-z]/g, '');
      const pubT = bodyOf(await (await fetch(`${B}/site/${sub2}`)).text()).trim();
      const prevT = bodyOf(await (await fetch(`${B}/api/personal-site/preview`, {
        method: 'POST', headers: AJ,
        body: JSON.stringify({ subdomain: sub2, text: RESUME, name: 'Alex Morgan', config: templateDoc(t.id) }),
      })).text()).trim();
      check(`template "${t.id}" preview === public`, pubT === prevT);

      // Element ids must be unique across the WHOLE document: the editor's
      // findElement searches the document and keeps the last match, and mobile
      // CSS class names are derived from the id.
      const doc = templateDoc(t.id);
      const ids = [];
      for (const pg of doc.pages) for (const s of pg.sections) for (const e of s.els) ids.push(e.id);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      check(`template "${t.id}" element ids unique`, dupes.length === 0, dupes.join(', '));

      // Everything must sit inside the 1200px design canvas and inside its
      // section. `h` is a min-height so overflow renders, but an element whose
      // declared box escapes the section is an authoring mistake — it overlaps
      // whatever comes next and drags the editor's selection box off-canvas.
      let oob = '';
      for (const pg of doc.pages) for (const s of pg.sections) for (const e of s.els) {
        if (e.x < 0 || e.x + e.w > 1200) oob = `${e.id} x:${e.x}+${e.w}`;
        else if (e.y < 0 || e.y + e.h > s.h) oob = `${e.id} y:${e.y}+${e.h} > section ${s.h}`;
      }
      check(`template "${t.id}" elements fit the canvas`, !oob, oob);

      // Every in-page CTA must point at a section that exists on the same page,
      // and every cross-page link at a page that exists.
      const slugs = doc.pages.map((p) => p.slug);
      let badLink = '';
      for (const pg of doc.pages) {
        const secIds = pg.sections.map((s) => s.id);
        for (const s of pg.sections) for (const e of s.els) {
          const p = e.props || {};
          if (p.anchor && !secIds.includes(p.anchor)) badLink = `${e.id} → #${p.anchor}`;
          if (p.page && !slugs.includes(p.page)) badLink = `${e.id} → page ${p.page}`;
        }
      }
      check(`template "${t.id}" links resolve`, !badLink, badLink);

      // …and the rendered page must actually carry the anchor ids, or the CTA
      // scrolls nowhere.
      const anchors = doc.pages[0].sections
        .flatMap((s) => s.els).map((e) => (e.props || {}).anchor).filter(Boolean);
      for (const a of new Set(anchors)) {
        check(`template "${t.id}" anchor #${a} rendered`, pubT.includes(`id="${a}"`));
      }
    }
  } catch (e) {
    failures++;
    console.error('FAIL  unexpected error —', e && e.message);
  }

  console.log(`\n${failures ? 'FAILED' : 'ALL PASS'} (${failures} failure${failures === 1 ? '' : 's'})`);
  server.close();
  db.close();
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  process.exit(failures ? 1 : 0);
});
