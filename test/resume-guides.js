#!/usr/bin/env node
/**
 * /resume-writing-for-* guides (batch B) — SEO + quality guardrails.
 *
 * Boots the real app and asserts, for every guide: 200 on the clean URL, unique
 * title (<=60) / meta (<=160) / H1, canonical, WebPage + FAQPage JSON-LD that
 * matches the visible FAQ exactly, 600+ words of visible instructional prose,
 * required instructional sections (licenses, ATS keywords, walkthrough),
 * different intent from the matching "/{role}-resume" page (no tailoring-tool
 * words; both directions linked), sitemap + hub presence, and that bracketed
 * "[X]" placeholders only ever appear inside the labelled illustrative samples.
 *
 * Usage: node test/resume-guides.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-guides-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
const { loadGuides } = require('../scripts/build-resume-guides.js');

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
const strip = (h) => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
const text = (h) => decode(strip(h).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

let PORT;
const server = app.listen(0, async () => {
  PORT = server.address().port;
  try {
    const guides = loadGuides();
    check('10 guides exist', guides.length === 10);
    const sitemap = fs.readFileSync(path.join(__dirname, '..', 'public', 'sitemap.xml'), 'utf8');
    const hub = (await req('/resume-examples')).body;
    const seen = { t: new Set(), m: new Set(), h: new Set() };

    for (const g of guides) {
      const url = '/' + g.slug;
      const r = await req(url);
      const b = r.body;
      check(`${url} 200`, r.status === 200);
      const title = decode((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
      const meta = decode((b.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
      const h1 = decode(((b.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '').replace(/<[^>]+>/g, ''));
      check(`${url} title <= 60`, title.length > 0 && title.length <= 60, String(title.length));
      check(`${url} meta 60..160`, meta.length >= 60 && meta.length <= 160, String(meta.length));
      check(`${url} exactly one H1`, (b.match(/<h1[\s>]/g) || []).length === 1);
      check(`${url} unique title/meta/H1`, !seen.t.has(title) && !seen.m.has(meta) && !seen.h.has(h1));
      seen.t.add(title); seen.m.add(meta); seen.h.add(h1);
      check(`${url} canonical is itself`, b.includes(`<link rel="canonical" href="https://resumetailored.com${url}"`));
      check(`${url} in sitemap.xml`, sitemap.includes(`<loc>https://resumetailored.com${url}</loc>`));
      check(`${url} linked from the /resume-examples hub`, hub.includes(`href="${url}"`));

      const ld = jsonLd(b);
      const web = ld.find(o => o['@type'] === 'WebPage'), faq = ld.find(o => o['@type'] === 'FAQPage');
      check(`${url} WebPage JSON-LD`, !!web && web.url === 'https://resumetailored.com' + url);
      check(`${url} FAQPage JSON-LD (4+ Qs)`, !!faq && faq.mainEntity.length >= 4);
      const visible = [...b.matchAll(/<div class="faq-a">([\s\S]*?)<\/div>/g)].map(m => decode(m[1]));
      check(`${url} FAQ JSON-LD matches visible FAQ`, !!faq && visible.length === faq.mainEntity.length && faq.mainEntity.every((q, i) => q.acceptedAnswer.text === visible[i]));

      const body = text(b);
      const wc = (body.match(/\S+/g) || []).length;
      check(`${url} has 800+ visible words (600+ profession-specific enforced in build)`, wc >= 800, String(wc));
      for (const id of ['licensure', 'keywords', 'walkthrough', 'mistakes', 'boards']) check(`${url} has #${id} section`, b.includes(`id="${id}"`));
      check(`${url} has 5+ numbered walkthrough steps`, (b.match(/<h3>\d+\. /g) || []).length >= 5);
      check(`${url} lists 15+ ATS keywords`, (b.match(/<div class="kw">[\s\S]*?<\/div>/g) || []).join('').split('<span>').length - 1 >= 15);

      // [X] placeholders must live only inside labelled illustrative samples.
      const noSamples = strip(b).replace(/<div class="sample">[\s\S]*?<\/div>/g, '');
      check(`${url} placeholders only inside labelled illustrative samples`, !/\[X\]/.test(noSamples) && (!/\[X\]/.test(b) || /Illustrative only/.test(b)));
      check(`${url} has no unsourced superlatives or fake stats`, !/(best-in-class|guaranteed|#1 |proven to)/i.test(body));

      // Different intent from the example page, and linked both ways.
      check(`${url} title/H1 avoid tailoring-tool intent words`, !/\b(tailor|tailored|tailoring|with ai|free)\b/i.test(title + ' ' + h1), title);
      check(`${url} CTA goes to the homepage, not /dashboard`, b.includes('<a href="/" class="btn btn-white btn-lg">') && !/href="\/dashboard" class="btn btn-(primary|white)/.test(b));
      for (const l of [...b.matchAll(/href="(\/[a-z0-9-]+)"/g)].map(m => m[1]).filter(l => /^\/(resume-writing-for|registered|teacher|software|sales|project|accountant|customer|marketing|electrician|resume-examples)/.test(l))) {
        check(`${url} internal link ${l} resolves`, (await req(l)).status === 200);
      }
      if (g.example) {
        check(`${url} links to ${g.example.href}`, b.includes(`href="${g.example.href}"`));
        const ex = (await req(g.example.href)).body;
        check(`${g.example.href} links back to ${url}`, ex.includes(`href="${url}"`));
        const exTitle = decode((ex.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
        check(`${url} title differs from ${g.example.href} title`, exTitle !== title && /^How to Write/i.test(title), `${title} vs ${exTitle}`);
      } else {
        check(`${url} (no example page exists) links to the resume-examples hub`, b.includes('href="/resume-examples"'));
      }
      for (const rel of g.related) check(`${url} links related guide /${rel}`, b.includes(`href="/${rel}"`));
    }
    console.log(failures ? `\nFAILED (${failures} failure${failures === 1 ? '' : 's'})` : '\nALL PASS (0 failures)');
    server.close(() => process.exit(failures ? 1 : 0));
  } catch (e) { console.error('THREW', e); server.close(() => process.exit(1)); }
});
