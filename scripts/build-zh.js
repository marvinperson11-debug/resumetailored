#!/usr/bin/env node
/*
 * build-zh.js — generate the static, indexable Chinese homepage at public/zh/index.html
 *
 * The English homepage (public/index.html) already carries a complete Chinese
 * translation, but it is applied at runtime by JavaScript (applyLang), so Google
 * only ever sees English in the HTML source. This script renders the page in a
 * headless browser, runs the page's own applyLang('zh'), and serialises the
 * resulting DOM to a standalone Chinese page — so the Chinese text lives in the
 * raw HTML and is indexable, with correct <html lang>, canonical, and hreflang.
 *
 * It uses the page's OWN translation dictionaries, so it never drifts from the
 * source translations. Re-run whenever the English homepage copy changes:
 *
 *   node server.js &                 # serve the site on :3000
 *   node scripts/build-zh.js         # (needs a Chromium via playwright/puppeteer)
 *
 * The generated file is committed and served statically — there is no build step
 * at request time.
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.ZH_BUILD_BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'public', 'zh', 'index.html');

// Resolve a Chromium: prefer the repo's own, else the scratchpad copy this repo
// was audited with, else a system install. Kept flexible so the script runs in
// CI or locally without pinning a browser download here.
function loadChromium() {
  const tries = ['playwright-core', 'playwright', 'puppeteer'];
  for (const m of tries) {
    try { const p = require(m); return p.chromium || p; } catch (_) {}
  }
  throw new Error('No Chromium driver found — run `npm i -D playwright-core` (dev only; the generated page is committed and served statically).');
}

const ZH = {
  title: 'ResumeTailored AI — AI 简历定制与求职信生成器',
  desc: '免费 AI 简历生成与定制工具。粘贴你的简历和任意职位描述，AI 在 60 秒内用精准关键词重写简历，通过 ATS 筛选，赢得更多面试。无需信用卡。',
  ogtitle: 'ResumeTailored AI — AI 简历定制与求职信生成器',
  ogdesc: '粘贴简历和职位描述，AI 用精准关键词重写你的简历，并在 30 秒内生成有力的求职信。',
};

(async () => {
  const chromium = loadChromium();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });
  // Apply the page's own Chinese translation, then hand back the serialised DOM.
  let html = await page.evaluate(() => {
    // eslint-disable-next-line no-undef
    applyLang('zh');
    document.documentElement.lang = 'zh-CN';
    // Strip runtime-injected chrome so it isn't frozen into the static file:
    // the cookie-consent banner (+ its injected <style>) is re-injected at
    // runtime and is language-aware, so a baked English copy must not persist.
    var cc = document.getElementById('rta-consent');
    if (cc) cc.remove();
    document.querySelectorAll('style').forEach(function (s) {
      if (s.textContent && s.textContent.indexOf('#rta-consent') !== -1) s.remove();
    });
    return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  });
  await browser.close();

  // ── Post-process the serialised English shell into a proper zh page ──────────
  const rep = (re, to, label) => {
    if (!re.test(html)) throw new Error('post-process miss: ' + label);
    html = html.replace(re, to);
  };
  rep(/<title>[^<]*<\/title>/, `<title>${ZH.title}</title>`, 'title');
  rep(/(<meta name="description" content=")[^"]*(")/, `$1${ZH.desc}$2`, 'description');
  rep(/(<link rel="canonical" href=")[^"]*(")/, `$1https://resumetailored.com/zh/$2`, 'canonical');
  rep(/(<meta property="og:title" content=")[^"]*(")/, `$1${ZH.ogtitle}$2`, 'og:title');
  rep(/(<meta property="og:description" content=")[^"]*(")/, `$1${ZH.ogdesc}$2`, 'og:description');
  rep(/(<meta property="og:url" content=")[^"]*(")/, `$1https://resumetailored.com/zh/$2`, 'og:url');
  // Bidirectional, self-referencing hreflang (both languages list all alternates).
  const HREF = `<link rel="alternate" hreflang="en" href="https://resumetailored.com/" />
  <link rel="alternate" hreflang="zh-CN" href="https://resumetailored.com/zh/" />
  <link rel="alternate" hreflang="x-default" href="https://resumetailored.com/" />`;
  rep(/<link rel="alternate" hreflang="en"[^>]*>\s*<link rel="alternate" hreflang="zh-CN"[^>]*>\s*<link rel="alternate" hreflang="x-default"[^>]*>/, HREF, 'hreflang block');
  // Root the relative favicon paths so they resolve under /zh/.
  html = html.replace(/(<link rel="icon" href=")favicon\.svg/, '$1/favicon.svg')
             .replace(/(<link rel="icon" href=")favicon-32\.png/, '$1/favicon-32.png')
             .replace(/(<link rel="apple-touch-icon" href=")apple-touch-icon\.png/, '$1/apple-touch-icon.png');
  // Language switch = real URL navigation back to the English page (SEO-correct).
  html = html.replace(/<\/body>/, `<script>function toggleLang(){window.location.href='/';}</script>\n</body>`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  console.log('wrote', OUT, '(' + html.length + ' bytes)');
})();
