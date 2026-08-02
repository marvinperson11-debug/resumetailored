/**
 * LLMS.TXT — a curated Markdown index for AI crawlers (ChatGPT, Claude,
 * Perplexity, …), one per published personal website.
 *
 * `generateLlmsTxt(siteData)` is the one reusable builder: it takes a plain
 * object — never a DB row or an Express request — so it can be called from
 * the publish route, a test, or anywhere else without dragging the database
 * along. The adapter that turns a `personal_sites` row into `siteData` lives
 * in server.js (`_siteLlmsTxtData`), next to the other site renderers it
 * mirrors.
 *
 * Personal sites here are rendered on demand from the `personal_sites` row on
 * every request (see `_renderPersonalSite`/`_serveSite` in server.js) — there
 * is no static per-site deploy directory to write a file into. This file is
 * served the same way: generated fresh on each request to
 * `/site/:sub/llms.txt` (and the host-based `<sub>.resumetailored.com/llms.txt`
 * equivalent), so it can never drift from what the site actually contains.
 */
'use strict';

function _clean(v) {
  return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {object} siteData
 * @param {string} siteData.name - H1 title (person or site name).
 * @param {string} [siteData.tagline] - 1-3 sentence description for the blockquote.
 * @param {Array<{title:string, url:string, description?:string}>} [siteData.pages]
 * @returns {string} the llms.txt file content, always ending in a newline.
 */
function generateLlmsTxt(siteData) {
  const name = _clean(siteData && siteData.name) || 'Personal Website';
  const tagline = _clean(siteData && siteData.tagline) || `The personal website of ${name}.`;
  const pages = Array.isArray(siteData && siteData.pages) ? siteData.pages : [];

  const lines = [`# ${name}`, '', `> ${tagline}`];

  const links = pages
    .map((p) => ({ title: _clean(p && p.title) || name, url: _clean(p && p.url), description: _clean(p && p.description) }))
    .filter((p) => p.url);

  if (links.length) {
    lines.push('', '## Pages');
    for (const p of links) {
      lines.push(p.description ? `- [${p.title}](${p.url}): ${p.description}` : `- [${p.title}](${p.url})`);
    }
  }

  return lines.join('\n') + '\n';
}

module.exports = { generateLlmsTxt };
