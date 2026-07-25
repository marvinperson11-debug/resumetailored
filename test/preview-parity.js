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
    check('template catalogue served', Array.isArray(cat.templates) && cat.templates.length === 4);
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
