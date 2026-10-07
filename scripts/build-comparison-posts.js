#!/usr/bin/env node
/**
 * Rewrites the body of the old comparison blog posts in place (same URL, same
 * chrome, same related-posts block and footer) from scripts/blog/comparison-posts.js,
 * and regenerates each post's .md source. Run: node scripts/build-comparison-posts.js
 *
 * Why in place: these URLs already rank and are linked; the problem was the
 * content (unsourced model-quality claims, invented tests, wrong competitor
 * facts), not the addresses.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BLOG = path.join(__dirname, '..', 'public', 'blog');
const MODIFIED = '2026-10-07';
const MODIFIED_LABEL = 'October 7, 2026';
const posts = require('./blog/comparison-posts.js');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escAttr = esc;
const jsonStr = (s) => JSON.stringify(String(s)).slice(1, -1);

function renderBody(post) {
  const out = [];
  out.push('<a href="/blog" class="back-link">← Back to Blog</a>');
  out.push('<div class="stat-box">' + post.stats.map(([n, l]) => `<div class="stat"><div class="stat-num">${esc(n)}</div><div class="stat-label">${esc(l)}</div></div>`).join('') + '</div>');
  for (const b of post.body) {
    if (b.h2) out.push(`<h2>${esc(b.h2)}</h2>`);
    else if (b.p) out.push(`<p>${esc(b.p)}</p>`);
    else if (b.note) out.push(`<div class="highlight-box"><p style="color:#d6eadf!important;font-weight:500">${esc(b.note)}</p></div>`);
    else if (b.ul) out.push('<ul>' + b.ul.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>');
    else if (b.table) {
      out.push(`<table class="comparison-table"><thead><tr>${b.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.table.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<td><strong>${esc(c)}</strong></td>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table>`);
    }
  }
  if (post.sources && post.sources.length) {
    out.push('<h2>Sources</h2><ul>' + post.sources.map((u) => `<li><a href="${u}" rel="noopener nofollow">${esc(u)}</a></li>`).join('') + '</ul>');
  }
  out.push('<div class="cta-inline"><h3>Try it on your own resume.</h3><p>Paste your resume and a job posting and see the result for yourself. A free account is all you need.</p><a href="/">Tailor My Resume Free →</a></div>');
  return out.join('\n  ');
}

function toMarkdown(post) {
  const L = [`# ${post.title}`, '', `**Category:** ${post.tag} | **Read time:** ${post.readMin} min | **Updated:** ${MODIFIED_LABEL}`, '', `**Source:** https://resumetailored.com/blog/${post.file}`, '', '---', ''];
  for (const b of post.body) {
    if (b.h2) L.push(`## ${b.h2}`, '');
    else if (b.p) L.push(b.p, '');
    else if (b.note) L.push(`> ${b.note}`, '');
    else if (b.ul) L.push(...b.ul.map((x) => `- ${x}`), '');
    else if (b.table) {
      L.push(`| ${b.table.head.join(' | ')} |`, `| ${b.table.head.map(() => '---').join(' | ')} |`, ...b.table.rows.map((r) => `| ${r.join(' | ')} |`), '');
    }
  }
  if (post.sources && post.sources.length) L.push('## Sources', '', ...post.sources.map((u) => `- ${u}`), '');
  return L.join('\n');
}

function rewrite(post) {
  const p = path.join(BLOG, post.file + '.html');
  let s = fs.readFileSync(p, 'utf8');
  const url = `https://resumetailored.com/blog/${post.file}`;
  const rep = (re, to, label, optional) => { if (!re.test(s)) { if (optional) return; throw new Error(`${post.file}: could not find ${label}`); } s = s.replace(re, to); };
  rep(/<title>[\s\S]*?<\/title>/, `<title>${esc(post.title)} | ResumeTailored AI</title>`, 'title');
  rep(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escAttr(post.description)}"/>`, 'description');
  rep(/<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${escAttr(post.title)}"/>`, 'og:title');
  rep(/<meta property="og:description" content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${escAttr(post.ogDescription)}"/>`, 'og:description');
  rep(/<meta name="twitter:title" content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${escAttr(post.title)}"/>`, 'twitter:title', true);
  rep(/<meta name="twitter:description" content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${escAttr(post.ogDescription)}"/>`, 'twitter:description', true);
  rep(/"headline": "[^"]*"/, `"headline": "${jsonStr(post.title)}"`, 'jsonld headline');
  rep(/"description": "[^"]*"/, `"description": "${jsonStr(post.description)}"`, 'jsonld description');
  rep(/"dateModified": "[^"]*"/, `"dateModified": "${MODIFIED}"`, 'jsonld dateModified');
  rep(/<(span|div) class="article-tag">[\s\S]*?<\/\1>/, (m, t) => `<${t} class="article-tag">${esc(post.tag)}</${t}>`, 'article-tag');
  rep(/<h1>[\s\S]*?<\/h1>/, `<h1>${esc(post.title)}</h1>`, 'h1');
  rep(/<div class="article-meta">[\s\S]*?<\/div>/, (m) => {
    const text = m.replace(/<[^>]+>/g, '').replace(/&bull;/g, '·');
    const date = (text.match(/([A-Z][a-z]+ \d{1,2}, \d{4})/) || [])[1] || 'June 2026';
    const by = (text.match(/By [^·]+?(?=\s*·)/) || [])[0];
    return `<div class="article-meta">${by ? by.trim() + ' · ' : ''}${date} · Updated ${MODIFIED_LABEL} · ${post.readMin} min read</div>`;
  }, 'article-meta');
  // Replace everything between <div class="article-body"> and the related-posts block.
  const a = s.indexOf('<div class="article-body">');
  const b = s.indexOf('<div class="related-posts">');
  if (a === -1 || b === -1 || b < a) throw new Error(`${post.file}: article-body/related-posts not found`);
  s = s.slice(0, a) + '<div class="article-body">\n  ' + renderBody(post) + '\n\n  ' + s.slice(b);
  // Cover-image / second CTA classes are gone with the old body; nothing else to patch.
  fs.writeFileSync(p, s);
  fs.writeFileSync(path.join(BLOG, post.file + '.md'), toMarkdown(post));
  console.log('rewrote', post.file);
}

if (require.main === module) for (const post of posts) rewrite(post);
module.exports = { posts };
