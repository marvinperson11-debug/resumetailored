#!/usr/bin/env node
/**
 * Accuracy guard for competitor claims (A.5). Pure file scan — no server.
 *
 * The comparison pages and posts once carried unsourced or false statements about
 * competitors (invented "GPT-4 vs Claude" outputs, a blind-review study we never ran,
 * named testimonials, stale/wrong prices, "no cover letter feature" for tools that have
 * one). This test fails if any of those patterns come back anywhere in public/, and
 * pins that the rewritten posts carry a dated, sourced update line.
 *
 * Usage: node test/comparison-claims.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const PUB = path.join(__dirname, '..', 'public');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(html|md|txt)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(PUB);

// [label, regex, case-insensitive?]
const BANNED = [
  ['"needs heavy/substantial editing" about a competitor', /(?:needs?|require[sd]?)\s+(?:heavy|substantial|a lot of)\s+(?:editing|work)/i],
  ['"cover letters need editing" chip', /Cover letters need editing|Needs editing/],
  ['stale competitor prices ($4.50 Kickresume, $24.95 Resume.io)', /\$4\.50|\$24\.95/],
  ['GPT-4 attributed to a competitor', /GPT-?4/i],
  ['claimed test / blind review we never ran', /We Tested Both|seven recruiters|blind-review/i],
  ['named testimonial blocks', /Real Switchers|Users Say After Switching|recently hired at|ex-Resume\.io|switched from Resume\.io/i],
  ['unsourced callback statistics', /Claude beats GPT|40% more interview callbacks|land 40%/i],
  ['false "no cover letter" claims about competitors', /no cover letter (?:feature|functionality|generation)|No cover letters/i],
  ['"score only" characterisations of competitors', /Score only|Score-Only|Basic generator|Manual paste only/],
  ['star-rated quotes', /★★★★★\s*["“]/],
];
for (const [label, re] of BANNED) {
  const hits = files.filter((f) => re.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(PUB, f));
  check(`no ${label} anywhere in public/`, hits.length === 0, hits.slice(0, 5).join(', '));
}

// The old flat comparison files (unreachable, but full of the above) must stay deleted.
for (const f of ['rezi', 'teal', 'jobscan', 'kickresume']) {
  check(`public/${f}-alternative.html stays deleted`, !fs.existsSync(path.join(PUB, `${f}-alternative.html`)));
}

// Rewritten posts: dated update line, sources or an explicit "what we are not claiming" disclaimer, no new tests claimed.
const POSTS = ['rezi-vs-resumetailored', 'teal-vs-resumetailored', 'jobscan-vs-resumetailored', 'why-rezi-cover-letters-fall-short', 'why-claude-writes-better-resumes', 'free-ats-resume-scanners-compared', 'resumetailored-vs-canva'];
for (const slug of POSTS) {
  const h = fs.readFileSync(path.join(PUB, 'blog', slug + '.html'), 'utf8');
  const md = fs.readFileSync(path.join(PUB, 'blog', slug + '.md'), 'utf8');
  check(`blog/${slug}: shows "Updated October 7, 2026"`, /Updated October 7, 2026/.test(h));
  check(`blog/${slug}: JSON-LD dateModified is 2026-10-07`, /"dateModified": "2026-10-07"/.test(h));
  check(`blog/${slug}: has a sources list, a dated note, or an explicit not-claiming section`, /<h2>Sources<\/h2>|checked October 7, 2026|retrieved October 7, 2026|What we are not claiming|could not retrieve|do not have a published, citable study/i.test(h));
  check(`blog/${slug}: .md source mirrors the new title`, md.startsWith('# ') && /Updated:\*{0,2}\s+October 7, 2026/.test(md));
}

// Directly tied statistics we removed from the posts we touched.
for (const slug of ['how-to-tailor-resume-with-ai', 'tailor-resume-to-job-description', 'how-to-beat-ats-filters', 'resume-keywords']) {
  const h = fs.readFileSync(path.join(PUB, 'blog', slug + '.html'), 'utf8');
  check(`blog/${slug}: no "88% / 75% rejected by ATS" statistic`, !/88%|75% of resumes/.test(h));
}
check('resume-keywords no longer attributes a statistic to Jobscan', !/according to research by Jobscan/.test(fs.readFileSync(path.join(PUB, 'blog', 'resume-keywords.html'), 'utf8')));

console.log(failures ? `\nFAILED (${failures} failure${failures === 1 ? '' : 's'})` : '\nALL PASS (0 failures)');
process.exit(failures ? 1 : 0);
