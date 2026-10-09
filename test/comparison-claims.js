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
    else if (/\.(html|md|txt|svg)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(PUB);

// [label, regex, case-insensitive?]
const BANNED = [
  ['"needs heavy/substantial editing" about a competitor', /(?:needs?|require[sd]?)\s+(?:heavy|substantial|a lot of)\s+(?:editing|work)/i],
  ['"cover letters need editing" chip', /Cover letters need editing|Needs editing/],
  ['stale competitor prices ($4.50 Kickresume, $24.95 Resume.io; $24.95 is valid for Jobscan annual)', /\$4\.50|Resume\.io[^.\n]{0,80}\$24\.95|\$24\.95[^.\n]{0,80}Resume\.io/],
  ['GPT-4 attributed to a competitor', /GPT-?4/i],
  ['claimed test / blind review we never ran', /We Tested Both|seven recruiters|blind-review/i],
  ['named testimonial blocks', /Real Switchers|Users Say After Switching|recently hired at|ex-Resume\.io|switched from Resume\.io/i],
  ['unsourced callback statistics', /Claude beats GPT|40% more (?:interview )?callbacks|land 40%|5[–-]10\s?[x×]/i],
  ['"75% of resumes rejected/filtered by ATS" statistic (EN + ZH, incl. stat tiles)', /75\s?%\s*of\s+(?:all\s+)?resumes|>\s*75\s?%\s*<|75\s?%\s*的简历|约\s?75\s?%\s*的|75<\/span><span class="stat-pct"|75 percent of resumes/i],
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

// /zety-alternative meets the same standard as /alternatives/*: dated, sourced, flagged.
{
  const z = fs.readFileSync(path.join(PUB, 'zety-alternative.html'), 'utf8');
  check('zety-alternative: carries a "verified October 7, 2026" line', /verified October 7, 2026/.test(z));
  check('zety-alternative: flags unconfirmed items "Check official site"', /Check official site/i.test(z));
  check('zety-alternative: links Zety\'s own pricing page as a source', /https:\/\/zety\.com\/pricing/.test(z));
  check('zety-alternative: no "surprise auto-renew" insinuation', !/surprise auto-renew|auto-?renew unexpectedly/i.test(z));
}

// No fabricated rating markup or star-rating strips on ANY page in public/ (no verified reviews exist).
// Star runs are allowed ONLY inside a named testimonial (a "testimonial" block or a "First L." attribution
// nearby), which are tracked and handled separately — a decorative strip next to "Powered by …" is not.
{
  const RATING_MARKUP = /aggregateRating|AggregateRating|ratingValue|reviewCount|ratingCount/;
  const RATING_TEXT = /\b[0-9]\.[0-9]\s*(?:\/|out of)\s*5\b|\b[0-9][0-9,]*\s+(?:customer |user |verified )?reviews\b|\bRated\s+[0-9]/i;
  const STAR_RUN = /[★⭐]{3,}|(?:&#9733;|&#x2605;|&starf;){3,}/g;
  const ratingFiles = fs.readdirSync(PUB, { recursive: true }).map((f) => path.join(PUB, String(f))).filter((f) => /\.(html|md|txt|js|svg)$/.test(f) && fs.statSync(f).isFile());
  const markup = [], text = [], strips = [];
  for (const f of ratingFiles) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(PUB, f);
    if (RATING_MARKUP.test(src)) markup.push(rel);
    if (RATING_TEXT.test(src.replace(/preview/gi, ''))) text.push(rel);
    let m;
    STAR_RUN.lastIndex = 0;
    while ((m = STAR_RUN.exec(src))) {
      const window = src.slice(Math.max(0, m.index - 300), m.index + 700);
      if (!/testimonial|\b[A-Z][a-z]{2,} [A-Z]\.[<,\s]/.test(window)) { strips.push(rel); break; }
    }
  }
  check('no AggregateRating / ratingValue / reviewCount markup on any page in public/', markup.length === 0, markup.slice(0, 5).join(', '));
  check('no "4.9/5", "312 reviews" or "Rated 4.9" rating text on any page in public/', text.length === 0, text.slice(0, 5).join(', '));
  check('no decorative star strips outside named testimonials on any page in public/', strips.length === 0, strips.slice(0, 5).join(', '));
  check('homepage + zh homepage + ai-resume-tailor + pro-tools are clean (named explicitly)', ['index.html', 'zh/index.html', 'ai-resume-tailor.html', 'pro-tools.html'].every((f) => !RATING_MARKUP.test(fs.readFileSync(path.join(PUB, f), 'utf8')) && !/hero-trust-stars/.test(fs.readFileSync(path.join(PUB, f), 'utf8'))));
}

console.log(failures ? `\nFAILED (${failures} failure${failures === 1 ? '' : 's'})` : '\nALL PASS (0 failures)');
process.exit(failures ? 1 : 0);
