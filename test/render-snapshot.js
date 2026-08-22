#!/usr/bin/env node
/**
 * Render regression check for the Create-a-Link (/r/:slug) and personal-site
 * (/site/:name) renderers. Comparison is byte-identical after normalizing the
 * checkout's platform line endings (Git may materialize goldens as CRLF on
 * Windows while template literals always render LF).
 *
 * Why: the Website Creator work evolves _renderPersonalSite() while "Create a
 * Link" must stay exactly as it is. This snapshots the exact HTML both renderers
 * produce for a fixed sample row and fails if it changes unexpectedly.
 *
 * Usage:
 *   node test/render-snapshot.js            # verify against goldens (CI mode)
 *   node test/render-snapshot.js --update   # (re-)write goldens after an
 *                                           # INTENTIONAL change (e.g. adding the
 *                                           # Link download button). Review the
 *                                           # diff before committing updated goldens.
 *
 * Requiring server.js does NOT boot the HTTP listener (guarded by
 * require.main === module); it only opens a SQLite DB, so we point DATA_DIR at a
 * throwaway temp dir.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-snap-'));

const { _shareResumeHtml, _renderPersonalSite } = require('../server.js');

// A Website Builder v2 site document: sections with absolutely-positioned
// elements. Snapshotted so unintended renderer changes are caught.
const GRID_CONFIG = JSON.stringify({
  v: 2, lang: 'en', theme: { primary: '6366F1', accent: '8B5CF6' },
  pages: [{
    id: 'home', name: 'Home', slug: 'home', isHome: true,
    sections: [
      {
        id: 's1', h: 520, bg: { type: 'gradient', value: 'linear-gradient(135deg,#030712,#1e1b4b)' },
        els: [
          { id: 'n', type: 'nav', x: 80, y: 30, w: 900, h: 40 },
          { id: 'h', type: 'heading', x: 80, y: 160, w: 700, h: 120, props: { text: 'Jordan Rivera', color: '#ffffff' } },
          { id: 't', type: 'paragraph', x: 80, y: 300, w: 520, h: 70, props: { text: 'Product manager based in NYC.', color: '#cbd5e1' } },
          { id: 'v', type: 'video', x: 640, y: 160, w: 480, h: 260, props: { src: 'https://example.com/v.mp4', label: 'About Me' } },
        ],
      },
      {
        id: 's2', h: 460, bg: { type: 'color', value: '#ffffff' },
        els: [{ id: 'r', type: 'resume', x: 80, y: 40, w: 1040, h: 380 }],
      },
    ],
  }],
});

const GOLDEN_DIR = path.join(__dirname, 'golden');
const UPDATE = process.argv.includes('--update');
const ORIGIN = 'https://resumetailored.com';

// A fixed, representative row exercising a two-column layout, photo-less avatar,
// contact line, and multiple section kinds.
const SAMPLE_ROW = {
  slug: 'sample-slug',
  subdomain: 'sample',
  name: 'Jordan Rivera',
  text: [
    'Jordan Rivera',
    'jordan@example.com | San Francisco, CA | linkedin.com/in/jordanrivera',
    '',
    'SUMMARY',
    'Senior product manager with 8 years shipping data products.',
    '',
    'EXPERIENCE',
    'Senior PM, DataCorp | 2020–Present',
    '• Led migration reducing infra costs 30%',
    '• Grew activation 22% via lifecycle redesign',
    '',
    'SKILLS',
    'Product Strategy, SQL, Roadmapping, A/B Testing',
    '',
    'EDUCATION',
    'B.S. Computer Science, UC Berkeley',
  ].join('\n'),
  accent: '8b5cf6',
  primary_hex: '4a1042',
  serif: 0,
  photo: null,
  hide_contact: 0,
  layout: 'rTwoCol',
  config: null, // legacy default — the case that must render identically
};

const cases = {
  // Create-a-Link (/r/:slug) — rendered exactly as the route serves it
  // (indexable, so shared resumes can be found by search + AI crawlers).
  'link.html': () => _shareResumeHtml(SAMPLE_ROW, ORIGIN, { indexable: true }),
  // A Website Builder v2 site document.
  'site-doc.html': () => _renderPersonalSite(
    { ...SAMPLE_ROW, config: GRID_CONFIG }, ORIGIN,
    { indexable: true, footer: '', canonicalUrl: `${ORIGIN}/site/${SAMPLE_ROW.subdomain}` },
  ),
};

fs.mkdirSync(GOLDEN_DIR, { recursive: true });
let failed = 0;
for (const [file, render] of Object.entries(cases)) {
  const normalizeEol = (value) => String(value).replace(/\r\n?/g, '\n');
  const out = normalizeEol(render());
  const goldenPath = path.join(GOLDEN_DIR, file);
  if (UPDATE || !fs.existsSync(goldenPath)) {
    fs.writeFileSync(goldenPath, out);
    console.log(`${UPDATE ? 'updated' : 'created'} golden: ${file} (${out.length} bytes)`);
    continue;
  }
  const golden = normalizeEol(fs.readFileSync(goldenPath, 'utf8'));
  if (golden === out) {
    console.log(`PASS  ${file} — content-identical (${out.length} bytes, LF-normalized)`);
  } else {
    failed++;
    console.error(`FAIL  ${file} — output changed vs golden (golden ${golden.length}B, now ${out.length}B).`);
    console.error('      If this change is intentional, re-run with --update and review the diff.');
  }
}

try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (_) {}
process.exit(failed ? 1 : 0);
