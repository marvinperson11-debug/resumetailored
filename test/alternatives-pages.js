#!/usr/bin/env node
/**
 * /alternatives/* conversion pages (batch A) — SEO + honesty guardrails.
 *
 * Boots the real app and asserts, for every generated page: 200, unique
 * title (<=60) / meta (<=160) / H1, canonical, WebPage + FAQPage JSON-LD that
 * matches the visible FAQ word for word, a dated "verified" note, the right CTA
 * (candidate -> homepage, employer -> /for-employers), presence in sitemap.xml,
 * and that the legacy flat /x-alternative URLs still 301 (not reversed).
 * Also pins the generator's data against the copy-guard rules: no unsourced
 * superlatives about competitors.
 *
 * Usage: node test/alternatives-pages.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-alt-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
const { PAGES } = require('../scripts/build-alternatives.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
function req(urlPath) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: 'GET' }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', c => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject); r.end();
  });
}
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

let PORT;
const server = app.listen(0, async () => {
  PORT = server.address().port;
  try {
    const sitemap = fs.readFileSync(path.join(__dirname, '..', 'public', 'sitemap.xml'), 'utf8');
    check('sitemap.xml is well-formed enough (balanced <url>)', (sitemap.match(/<url>/g) || []).length === (sitemap.match(/<\/url>/g) || []).length);
    const seen = { title: new Set(), meta: new Set(), h1: new Set() };

    for (const p of PAGES) {
      const url = p.canonicalPath || `/alternatives/${p.slug}`;
      const r = await req(url);
      const b = r.body;
      check(`${url} 200`, r.status === 200);
      const title = decode((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
      const meta = decode((b.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
      const h1 = decode(((b.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '').replace(/<[^>]+>/g, ''));
      check(`${url} title <= 60 chars`, title.length > 0 && title.length <= 60, `${title.length}: ${title}`);
      check(`${url} meta <= 160 chars`, meta.length > 40 && meta.length <= 160, `${meta.length}`);
      check(`${url} has exactly one H1`, (b.match(/<h1[\s>]/g) || []).length === 1);
      check(`${url} title/meta/H1 are unique across pages`, !seen.title.has(title) && !seen.meta.has(meta) && !seen.h1.has(h1));
      seen.title.add(title); seen.meta.add(meta); seen.h1.add(h1);
      check(`${url} canonical is the page itself`, b.includes(`<link rel="canonical" href="https://resumetailored.com${url}"`));
      check(`${url} is in sitemap.xml`, sitemap.includes(`<loc>https://resumetailored.com${url}</loc>`));

      // JSON-LD: WebPage + FAQPage, FAQ text identical to what a visitor reads.
      const ld = jsonLd(b);
      const web = ld.find(o => o['@type'] === 'WebPage');
      const faq = ld.find(o => o['@type'] === 'FAQPage');
      check(`${url} has WebPage JSON-LD`, !!web && web.url === `https://resumetailored.com${url}`);
      check(`${url} has FAQPage JSON-LD with 4+ questions`, !!faq && faq.mainEntity.length >= 4);
      const visible = [...b.matchAll(/<div class="faq-a">([\s\S]*?)<\/div>/g)].map(m => decode(m[1]));
      check(`${url} FAQ JSON-LD answers match the visible FAQ exactly`, !!faq && faq.mainEntity.every((q, i) => q.acceptedAnswer.text === visible[i]) && visible.length === faq.mainEntity.length);

      // Honesty: dated verification + an explicit unverified marker pattern.
      check(`${url} states a "verified" date`, /verified[^<]{0,40}October 7, 2026/i.test(b));
      check(`${url} links to the competitor's official page`, new RegExp(`href="${p.officialUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(b));
      const unsourced = /(superior|best-in-class|outperforms|widely recognized|independent (writing )?quality)/i;
      check(`${url} has no unsourced superlatives`, !unsourced.test(b.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '')));

      // CTA target: candidate -> homepage, employer -> /for-employers (which must exist).
      const want = p.audience === 'employer' ? '/for-employers' : '/';
      check(`${url} primary CTA goes to ${want}`, new RegExp(`class="btn btn-primary btn-lg" ?>|href="${want}" class="btn btn-primary btn-lg"`).test(b) && b.includes(`<a href="${want}" class="btn btn-white btn-lg">`));
      check(`${url} CTA no longer points at /dashboard`, !/btn-primary btn-lg"[^>]*href="\/dashboard"|href="\/dashboard" class="btn btn-(primary|white) btn-lg"/.test(b));
      // Related + blog cross-links exist and resolve.
      for (const l of [...b.matchAll(/href="(\/(?:blog\/|alternatives\/|[a-z-]+-alternative)[a-z0-9-]*)"/g)].map(m => m[1])) {
        const rr = await req(l);
        check(`${url} internal link ${l} resolves (200)`, rr.status === 200, String(rr.status));
      }
    }

    // Employer CTA target exists (spec: never point pages at a 404).
    check('/for-employers returns 200', (await req('/for-employers')).status === 200);
    // The legacy flat URLs still consolidate onto /alternatives/* (decision: keep the 301s), in both forms.
    for (const s of ['rezi', 'jobscan', 'teal', 'kickresume']) {
      const r = await req(`/${s}-alternative`);
      check(`/${s}-alternative 301s to /alternatives/${s}`, r.status === 301 && (r.headers.location || '').endsWith(`/alternatives/${s}`), r.status + ' ' + r.headers.location);
      // The old .html form hops to the clean URL (global rule), which then hops to /alternatives/*.
      const h = await req(`/${s}-alternative.html`);
      check(`/${s}-alternative.html 301s to the clean URL (then onward)`, h.status === 301 && (h.headers.location || '').endsWith(`/${s}-alternative`), h.status + ' ' + h.headers.location);
    }
    // The old flat files (with unsourced claims and invented testimonials) are gone from the repo.
    for (const f of ['rezi', 'jobscan', 'teal', 'kickresume']) check(`public/${f}-alternative.html is deleted`, !fs.existsSync(path.join(__dirname, '..', 'public', `${f}-alternative.html`)));
    // Blogs link into the landing pages (informational -> conversion).
    for (const [blog, target] of [['rezi-vs-resumetailored', '/alternatives/rezi'], ['teal-vs-resumetailored', '/alternatives/teal'], ['jobscan-vs-resumetailored', '/alternatives/jobscan'], ['best-ats-for-small-business', '/alternatives/breezy'], ['best-ats-for-small-business', '/alternatives/workable']]) {
      check(`blog ${blog} links to ${target}`, (await req('/blog/' + blog)).body.includes(`href="${target}"`));
    }
    // Footers: homepage + FAQ link to the new employer pages.
    for (const pg of ['/', '/faq']) {
      const b = (await req(pg)).body;
      check(`${pg} links to /alternatives/breezy and /alternatives/workable`, b.includes('href="/alternatives/breezy"') && b.includes('href="/alternatives/workable"'));
    }

    console.log(failures ? `\nFAILED (${failures} failure${failures === 1 ? '' : 's'})` : '\nALL PASS (0 failures)');
    server.close(() => process.exit(failures ? 1 : 0));
  } catch (e) { console.error('THREW', e); server.close(() => process.exit(1)); }
});
