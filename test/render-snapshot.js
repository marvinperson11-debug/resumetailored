#!/usr/bin/env node
/**
 * Byte-identical render regression check for the Create-a-Link (/r/:slug) and
 * personal-site (/site/:name) renderers.
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
  'link.html': () => _shareResumeHtml(SAMPLE_ROW, ORIGIN),
  'site.html': () => _renderPersonalSite(SAMPLE_ROW, ORIGIN, {
    indexable: true, footer: '', canonicalUrl: `${ORIGIN}/site/${SAMPLE_ROW.subdomain}`,
  }),
};

fs.mkdirSync(GOLDEN_DIR, { recursive: true });
let failed = 0;
for (const [file, render] of Object.entries(cases)) {
  const out = render();
  const goldenPath = path.join(GOLDEN_DIR, file);
  if (UPDATE || !fs.existsSync(goldenPath)) {
    fs.writeFileSync(goldenPath, out);
    console.log(`${UPDATE ? 'updated' : 'created'} golden: ${file} (${out.length} bytes)`);
    continue;
  }
  const golden = fs.readFileSync(goldenPath, 'utf8');
  if (golden === out) {
    console.log(`PASS  ${file} — byte-identical (${out.length} bytes)`);
  } else {
    failed++;
    console.error(`FAIL  ${file} — output changed vs golden (golden ${golden.length}B, now ${out.length}B).`);
    console.error('      If this change is intentional, re-run with --update and review the diff.');
  }
}

try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (_) {}
process.exit(failed ? 1 : 0);
