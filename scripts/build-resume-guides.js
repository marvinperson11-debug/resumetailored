#!/usr/bin/env node
/**
 * Generates the /resume-writing-for-* instructional guides (batch B) from
 * scripts/guides/*.js — one data module per profession. The visible FAQ and the
 * FAQPage JSON-LD come from the same array, and the build refuses to emit a
 * guide that is thin (profession-specific words < MIN_WORDS), has a title > 60
 * chars, a meta > 160 chars, or whose title/H1 re-uses the existing
 * "/{role}-resume" page's phrase (different intent on purpose).
 *
 * Run: node scripts/build-resume-guides.js
 * Page chrome (CSS) is reused from public/alternatives/kickresume.html.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ORIGIN = 'https://resumetailored.com';
const MODIFIED = '2026-10-07';
const MIN_WORDS = 600;
const PUB = path.join(__dirname, '..', 'public');
const GUIDES_DIR = path.join(__dirname, 'guides');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const words = (s) => (String(s).match(/[A-Za-z0-9$%][A-Za-z0-9$%'’\/.+#-]*/g) || []).length;

function loadGuides() {
  return fs.readdirSync(GUIDES_DIR).filter((f) => f.endsWith('.js')).sort().map((f) => require(path.join(GUIDES_DIR, f)));
}

// Words that are about the profession (everything the reader reads except nav/footer/CTA boilerplate).
function contentWords(g) {
  const parts = [g.intro, ...g.screeners, ...g.licensure.flatMap((l) => [l.name, l.how]),
    ...g.keywords.flatMap((k) => [k.label, k.terms.join(' ')]),
    ...g.walkthrough.flatMap((w) => [w.h, w.body, w.example || '']),
    ...g.mistakes, g.boards.intro, ...g.boards.items, ...g.faq.flat()];
  return words(parts.join(' '));
}

function loadCss() {
  const k = fs.readFileSync(path.join(PUB, 'alternatives', 'kickresume.html'), 'utf8');
  const css = k.match(/<style>([\s\S]*?)<\/style>/)[1];
  return css + `
.prose{max-width:820px;margin:0 auto}
.prose p{line-height:1.75;margin:0 0 14px}
.prose h3{margin:26px 0 8px}
.prose ul,.prose ol{margin:8px 0 16px 20px;line-height:1.7}
.kw{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 18px}
.kw span{border:1px solid rgba(128,128,128,.4);border-radius:999px;padding:4px 12px;font-size:14px}
.kwgroup{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;opacity:.7;margin:18px 0 4px}
.sample{border-left:3px solid #2E7D53;background:rgba(46,125,83,.08);padding:12px 16px;margin:10px 0 18px;border-radius:0 10px 10px 0;line-height:1.65;font-size:15px}
.sample small{display:block;opacity:.7;margin-top:6px}
.toc{display:flex;flex-wrap:wrap;gap:8px 18px;margin:0 auto 8px;max-width:820px;font-size:14px}
html,body{overflow-x:hidden}
@media(max-width:640px){.container{padding-left:16px;padding-right:16px}}`;
}

function jsonLd(g, url, title, meta) {
  const web = {
    '@context': 'https://schema.org', '@type': 'WebPage', '@id': url + '#webpage', url, name: title, description: meta,
    inLanguage: 'en', dateModified: MODIFIED, isPartOf: { '@type': 'WebSite', name: 'ResumeTailored AI', url: ORIGIN + '/' },
    about: { '@type': 'Thing', name: `Resume writing for ${g.who}` },
  };
  const faq = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: g.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
  return [web, faq].map((o) => `  <script type="application/ld+json">\n${JSON.stringify(o, null, 2)}\n  </script>`).join('\n');
}

function render(g, all, css) {
  const url = `${ORIGIN}/${g.slug}`;
  const li = (a) => a.map((x) => `<li>${esc(x)}</li>`).join('');
  const toc = [['licensure', 'Licenses & certifications'], ['keywords', 'ATS keywords'], ['walkthrough', 'Section by section'], ['mistakes', 'Common mistakes'], ['boards', 'Where to apply'], ['faq', 'FAQ']]
    .map(([id, l]) => `<a href="#${id}">${l}</a>`).join('');
  const lic = g.licensure.map((l) => `<li><strong>${esc(l.name)}.</strong> ${esc(l.how)}</li>`).join('');
  const kws = g.keywords.map((k) => `<div class="kwgroup">${esc(k.label)}</div><div class="kw">${k.terms.map((t) => `<span>${esc(t)}</span>`).join('')}</div>`).join('');
  const walk = g.walkthrough.map((w, i) => `<h3>${i + 1}. ${esc(w.h)}</h3><p>${esc(w.body)}</p>${w.example ? `<div class="sample">${esc(w.example)}<small>Illustrative only. Replace the bracketed placeholders with your own real numbers; never invent them.</small></div>` : ''}`).join('\n');
  const faqHtml = g.faq.map(([q, a]) => `      <div class="faq-item">\n        <div class="faq-q">${esc(q)}<span class="faq-arrow">&#8964;</span></div>\n        <div class="faq-a">${esc(a)}</div>\n      </div>`).join('\n');
  const rel = all.filter((x) => g.related.includes(x.slug)).map((x) => `<a href="/${x.slug}">${esc(x.linkLabel)}</a>`).join(' &bull; ');
  const exLine = g.example
    ? `Want the AI to tailor it for you? Open the <a href="${g.example.href}">${esc(g.example.label)}</a> page, paste your resume and a job posting, and get a tailored version in about 30 seconds.`
    : `Want the AI to tailor it for you? Browse <a href="/resume-examples">resume pages by job title</a>, or paste your resume and a job posting on the <a href="/">homepage</a> to get a tailored version in about 30 seconds.`;
  const footerLinks = [['Blog', '/blog'], ['Resume Examples', '/resume-examples'], ['Pricing', '/pricing'], ['FAQ', '/faq'], ['Free ATS Keyword Tool', '/tools/ats-keyword-extractor']]
    .map(([l, h]) => `      <a href="${h}">${l}</a>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(g.title)}</title>
  <meta name="description" content="${esc(g.meta)}" />
  <meta name="keywords" content="${esc(g.keywords_meta)}" />
  <link rel="canonical" href="${url}" />
  <meta property="og:title" content="${esc(g.title)}" />
  <meta property="og:description" content="${esc(g.meta)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:type" content="article" />
  <meta property="og:image" content="${ORIGIN}/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(g.title)}" />
  <meta name="twitter:description" content="${esc(g.meta)}" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="/favicon-32.png" sizes="32x32" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <script>
  (function(){var ID='G-JWC76X5X68',loaded=false;window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments);};gtag('js',new Date());gtag('config',ID);
  var ev=['scroll','pointerdown','keydown','touchstart','mousemove'];function load(){if(loaded)return;loaded=true;ev.forEach(function(e){window.removeEventListener(e,load,{passive:true});});var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+ID;document.head.appendChild(s);}
  ev.forEach(function(e){window.addEventListener(e,load,{passive:true});});setTimeout(load,3000);})();
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
${jsonLd(g, url, g.title, g.meta)}
  <style>${css}</style>
</head>
<body>

<nav class="nav">
  <div class="nav-inner">
    <a href="/" class="logo">ResumeTailored<span class="badge-ai">AI</span></a>
    <div class="nav-links">
      <a href="/how-it-works">How It Works</a>
      <a href="/resume-examples">Resume Examples</a>
      <a href="/blog">Blog</a>
    </div>
    <div class="nav-actions">
      <a href="/dashboard" class="btn btn-ghost">Log In</a>
      <a href="/" class="btn btn-primary">Tailor My Resume Free →</a>
    </div>
    <button class="hamburger" onclick="document.getElementById('mob').classList.add('open')" aria-label="Menu"><span></span><span></span><span></span></button>
  </div>
</nav>
<div class="mobile-menu" id="mob">
  <button class="mobile-close" onclick="document.getElementById('mob').classList.remove('open')">&times;</button>
  <a href="/how-it-works">How It Works</a>
  <a href="/resume-examples">Resume Examples</a>
  <a href="/blog">Blog</a>
  <a href="/" class="btn btn-primary btn-lg">Tailor My Resume Free →</a>
</div>

<section class="hero">
  <div class="container">
    <div class="hero-badge">Resume guide &bull; ${esc(g.badge)}</div>
    <h1>${esc(g.h1)}</h1>
    <p class="hero-sub">${esc(g.intro)}</p>
    <div class="hero-cta">
      <a href="/" class="btn btn-primary btn-lg">Tailor My Resume Free →</a>
      <a href="#walkthrough" class="btn btn-ghost btn-lg">Jump to the walkthrough &darr;</a>
    </div>
    <p class="hero-note">Free account &bull; Unlimited tailoring &bull; Updated October 2026</p>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="toc">${toc}</div>
    <div class="prose">
      <h2 class="section-title" style="text-align:left">What hiring teams screen for</h2>
      <ul>${li(g.screeners)}</ul>

      <h2 class="section-title" id="licensure" style="text-align:left">${esc(g.licensureTitle)}</h2>
      <ul>${lic}</ul>

      <h2 class="section-title" id="keywords" style="text-align:left">ATS keywords for ${esc(g.who)}</h2>
      <p>Use these only where they are true for you, and mirror the exact wording of the posting you are applying to. An applicant tracking system matches phrases, so “${esc(g.keywordTip.a)}” and “${esc(g.keywordTip.b)}” can be treated as different things.</p>
      ${kws}

      <h2 class="section-title" id="walkthrough" style="text-align:left">Section by section: building the resume</h2>
      ${walk}

      <h2 class="section-title" id="mistakes" style="text-align:left">Common mistakes to avoid</h2>
      <ul>${li(g.mistakes)}</ul>

      <h2 class="section-title" id="boards" style="text-align:left">Where to apply, and what the ATS will do</h2>
      <p>${esc(g.boards.intro)}</p>
      <ul>${li(g.boards.items)}</ul>
      <p>${exLine}</p>
      <p>Related guides: ${rel}</p>
    </div>
  </div>
</section>

<section class="section section-gray" id="faq">
  <div class="container">
    <p class="section-eyebrow">Questions</p>
    <h2 class="section-title">Frequently asked <span>questions</span></h2>
    <div class="faq-list">
${faqHtml}
    </div>
  </div>
</section>

<section class="cta-banner">
  <div class="container">
    <h2>${esc(g.cta.h)}</h2>
    <p>${esc(g.cta.t)}</p>
    <a href="/" class="btn btn-white btn-lg">Tailor My Resume Free →</a>
    <p class="cta-note">Unlimited free tailoring &bull; Pro $19.00/mo &bull; Lifetime $129</p>
  </div>
</section>

<footer class="footer">
  <div class="footer-inner">
    <a href="/" class="logo">ResumeTailored<span class="badge-ai">AI</span></a>
    <div class="footer-links">
${footerLinks}
    </div>
    <div class="footer-copy">&copy; 2026 ResumeTailored AI</div>
  </div>
</footer>

<script>document.querySelectorAll('.faq-q').forEach(function(q){q.addEventListener('click',function(){q.parentElement.classList.toggle('open');});});</script>
<script src="/mobile-native.js" defer></script>
<script src="/site-nav.js" defer></script>
</body>
</html>
`;
}

function validate(all) {
  const titles = new Set(), metas = new Set(), h1s = new Set();
  for (const g of all) {
    const n = contentWords(g);
    if (n < MIN_WORDS) throw new Error(`${g.slug}: only ${n} profession-specific words (< ${MIN_WORDS})`);
    if (g.title.length > 60) throw new Error(`${g.slug}: title ${g.title.length} chars`);
    if (g.meta.length > 160 || g.meta.length < 60) throw new Error(`${g.slug}: meta ${g.meta.length} chars`);
    if (titles.has(g.title) || metas.has(g.meta) || h1s.has(g.h1)) throw new Error(`${g.slug}: duplicate title/meta/h1`);
    titles.add(g.title); metas.add(g.meta); h1s.add(g.h1);
    if (g.faq.length < 4) throw new Error(`${g.slug}: needs 4+ FAQ`);
    if (g.walkthrough.length < 5) throw new Error(`${g.slug}: needs 5+ walkthrough sections`);
    if (g.example) {
      // Different query intent from the existing "/{role}-resume" page: the guide must not
      // re-use that page's own title phrase ("<Role> Resume: Tailor It …").
      const ex = fs.readFileSync(path.join(PUB, g.example.href.replace(/^\//, '') + '.html'), 'utf8');
      const exTitle = (ex.match(/<title>(.*?)<\/title>/s) || [])[1] || '';
      // Same head term ("<role> resume") is unavoidable, but the QUERY INTENT must differ: the example
      // page sells AI tailoring ("<Role> Resume: Tailor It to Any Job with AI"), the guide teaches
      // writing. So the guide may not borrow the example page's modifier words or its H1.
      const exH1 = ((ex.match(/<h1[^>]*>(.*?)<\/h1>/s) || [])[1] || '').replace(/<[^>]+>/g, '').toLowerCase();
      if (/\b(tailor|tailored|tailoring|with ai|free)\b/i.test(g.title + ' ' + g.h1)) {
        throw new Error(`${g.slug}: guide title/H1 uses tailoring-tool intent words (${g.title})`);
      }
      if (exTitle.toLowerCase().includes(g.title.toLowerCase().split(':')[0]) || (exH1 && g.h1.toLowerCase().includes(exH1.slice(0, 25)))) {
        throw new Error(`${g.slug}: title/H1 duplicates the example page's ("${exTitle}")`);
      }
      if (!/^how to write/i.test(g.title)) throw new Error(`${g.slug}: guide titles must be "How to write…" (instructional intent)`);
    }
    for (const r of g.related) if (!all.some((x) => x.slug === r)) throw new Error(`${g.slug}: unknown related ${r}`);
  }
}

function main() {
  const all = loadGuides();
  validate(all);
  const css = loadCss();
  for (const g of all) {
    fs.writeFileSync(path.join(PUB, g.slug + '.html'), render(g, all, css));
    console.log(`wrote public/${g.slug}.html  words=${contentWords(g)}  title=${g.title.length}  meta=${g.meta.length}`);
  }
}
if (require.main === module) main();
module.exports = { loadGuides, contentWords };
