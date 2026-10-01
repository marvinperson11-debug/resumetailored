#!/usr/bin/env node
/**
 * LIVE-AUDIT FOLLOW-UP — browser verification (Chromium), real geometry / DOM / network.
 *
 * Part A (marketing site, Express): nav, anchors + scroll-margin, template-pack
 *   section, hero, honest-copy claims, /pricing/ redirect, cancel page reachable.
 * Part B (employer + candidate app components): the REAL React components are
 *   bundled with esbuild (framework modules stubbed in audit-harness/stubs.tsx)
 *   and driven in Chromium — every changed Upgrade CTA, the Office banner, Team
 *   seat guard, Settings plan panel, preview-banner sync, PRO badges, Select
 *   (#16), locked banner wrap (#19).
 *
 * Needs:  npm i --no-save playwright-core esbuild     (SKIPs cleanly without them)
 * Usage:  node test/browser/audit-followup.js
 */
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
let chromium, esbuild;
try { ({ chromium } = require('playwright-core')); esbuild = require('esbuild'); }
catch (e) { console.log('SKIP  playwright-core / esbuild not installed — `npm i --no-save playwright-core esbuild`.'); process.exit(0); }

const ROOT = path.resolve(__dirname, '../..');
const PLAT = path.join(ROOT, 'resumetailored-platform');
const HARN = path.join(__dirname, 'audit-harness');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : '  → ' + detail}`); };

async function buildHarness(outdir) {
  const stubs = path.join(HARN, 'stubs.tsx');
  await esbuild.build({
    entryPoints: [path.join(HARN, 'entry.tsx')], bundle: true, outfile: path.join(outdir, 'harness.js'),
    format: 'iife', jsx: 'automatic', loader: { '.json': 'json' }, logLevel: 'error',
    define: { 'process.env.NODE_ENV': process.env.HARNESS_DEV ? '"development"' : '"production"' },
    nodePaths: [path.join(PLAT, 'node_modules')],
    plugins: [{ name: 'alias', setup(b) {
      b.onResolve({ filter: /^@\// }, a => {
        const base = path.join(PLAT, a.path.slice(2));
        for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) { try { if (fs.statSync(base + ext).isFile()) return { path: base + ext }; } catch (_) {} }
      });
      b.onResolve({ filter: /^next\/(link|navigation)$|^@clerk\/nextjs$/ }, () => ({ path: stubs }));
      // One React only: the repo root also has a copy (Remotion), which must not win.
      b.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, a => ({ path: require.resolve(a.path, { paths: [PLAT] }) }));
    } }],
  });
  // Tailwind CSS from the app's own config + globals, scanning the real source.
  const { execFileSync } = require('child_process');
  execFileSync(path.join(PLAT, 'node_modules/.bin/tailwindcss'), ['-c', path.join(PLAT, 'tailwind.config.ts'), '-i', path.join(PLAT, 'app/globals.css'), '-o', path.join(outdir, 'harness.css')], { cwd: PLAT, stdio: 'pipe' });
  fs.writeFileSync(path.join(outdir, 'harness.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="harness.css"></head><body class="bg-navy text-cream" style="padding:16px"><div id="root"></div><script src="harness.js"></script></body></html>');
}

function serveDir(dir) {
  return new Promise(r => { const s = http.createServer((q, res) => { const f = path.join(dir, q.url.split('?')[0].replace(/^\//, '')); fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(d); }); }); s.listen(0, () => r(s)); });
}

(async () => {
  if (process.env.AUDIT_BUILD_ONLY) { const o = process.env.AUDIT_BUILD_ONLY; fs.mkdirSync(o, { recursive: true }); await buildHarness(o); console.log('built', o); return; }
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch({ executablePath: exe && fs.statSync(exe).isFile() ? exe : undefined, args: ['--no-sandbox'] });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-audit-'));

  // ───────────── Part A: marketing site ─────────────
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-audit-data-'));
  process.env.RT_DISABLE_RATE_LIMIT = '1';
  const { app } = require(path.join(ROOT, 'server.js'));
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  await pg.goto(base + '/', { waitUntil: 'domcontentloaded' });
  const hrefs = await pg.$$eval('.club-nav__links a', as => as.map(a => a.getAttribute('href')));
  check('A2 /how-it-works is in the main nav', hrefs.includes('/how-it-works'), JSON.stringify(hrefs));
  const mobile = await pg.$$eval('#clubMobileMenu a', as => as.map(a => a.getAttribute('href')));
  check('A2 /how-it-works is in the mobile menu', mobile.includes('/how-it-works'));
  const door = await pg.$eval('.ecosystem-door[data-context="job-seeker"]', a => a.getAttribute('href'));
  check('A hero door "Tailor My Resume" links straight to the app', door === 'https://app.resumetailored.com', door);
  const h1 = await pg.$eval('#ecosystem-title', e => e.textContent);
  check('A hero says "AI resume tailoring"', /AI resume tailoring/i.test(h1), h1);
  const memb = await pg.$eval('a[data-i18n="eco_nav_membership"]', a => a.getAttribute('href'));
  check('A Membership anchor targets #pricing', memb === '#pricing');
  // Membership click actually lands on the Plans section, clear of the sticky nav
  await pg.click('a[data-i18n="eco_nav_membership"]'); await pg.waitForTimeout(700);
  const planTop = await pg.$eval('#pricing', e => e.getBoundingClientRect().top);
  check('A Membership click lands on #pricing', planTop >= -2 && planTop < 400, `top=${planTop}`);
  const sm = await pg.$eval('#pricing .section-title', e => parseFloat(getComputedStyle(e).scrollMarginTop));
  const smAny = await pg.evaluate(() => { const e = document.querySelector('.faq-q, .faq-item, [id]:not(main)'); return parseFloat(getComputedStyle(e).scrollMarginTop); });
  check('A #30 scroll-margin clears the sticky nav (≥80px)', sm >= 80 || smAny >= 80, `title=${sm} any=${smAny}`);
  // Template packs vs Plans
  const eyebrows = await pg.$$eval('#tiers .section-eyebrow, #pricing .section-eyebrow', e => e.map(x => x.textContent.trim()));
  check('A3 "Template packs" and "Plans" are separate sections', eyebrows.join('|') === 'Template packs|Plans', eyebrows.join('|'));
  const badges = await pg.$$eval('#tiers .tier-level-badge', e => e.map(x => x.textContent.trim()));
  check('A3 pack cards say they are packs included with Pro (no $19 price on cards)', badges.length === 3 && badges.every(b => /^Template pack/.test(b)) && !badges.some(b => /\$/.test(b)), badges.join(' / '));
  const btns = await pg.$$eval('#tiers .tier-card .btn', e => e.map(x => x.textContent.trim()));
  check('A3 pack buttons no longer sell "$19" plans', !btns.some(b => /\$19/.test(b)), btns.join(' / '));
  const bgT = await pg.$eval('#tiers', e => getComputedStyle(e).backgroundColor), bgP = await pg.$eval('#pricing', e => getComputedStyle(e).backgroundColor);
  check('A3 packs section is visually distinct from Plans', bgT !== bgP, `${bgT} vs ${bgP}`);
  const lifetime = await pg.$eval('#pricing', e => /\$129/.test(e.textContent));
  check('A Plans section shows the $129 lifetime option', lifetime);
  const body = await pg.content();
  check('A "No Account Required" is gone from the home page', !/no account required/i.test(body));
  check('A tagline jargon removed', !/people office/i.test(body));
  const contact = await pg.$eval('[data-i18n="footer_contact"]', a => a.getAttribute('href'));
  check('A Contact Us has a real href', /^mailto:/.test(contact), contact);
  // redirects / reachability
  const r0 = await ctx.request.get(base + '/pricing', { maxRedirects: 0 });
  check('A8 /pricing itself serves the page (200, no redirect loop)', r0.status() === 200, String(r0.status()));
  const r1 = await ctx.request.get(base + '/pricing/', { maxRedirects: 0 });
  check('A /pricing/ 301 → /pricing', r1.status() === 301 && /\/pricing$/.test(r1.headers()['location'] || ''), r1.status() + ' ' + r1.headers()['location']);
  // Follow redirects by hand (the app host is external, so stop when we leave this server).
  async function chain(u) {
    const hops = []; let cur = base + u;
    for (let i = 0; i < 5; i++) {
      const r = await ctx.request.get(cur, { maxRedirects: 0 });
      const loc = r.headers()['location'];
      hops.push(`${r.status()}${loc ? ' → ' + loc : ''}`);
      if (!loc) return { hops, final: r };
      if (/^https?:\/\//.test(loc) && !loc.startsWith(base)) return { hops, final: null, left: loc };
      cur = new URL(loc, cur).href;
    }
    return { hops, final: null };
  }
  const c1 = await chain('/cancel.html');
  check('A11 /cancel.html ends on the real cancellation page, not the app sign-in', !!c1.final && c1.final.status() === 200 && /Cancel Anytime/i.test(await c1.final.text()) && !c1.left, c1.hops.join(' | '));
  const c2 = await chain('/employer.html');
  check('A6 legacy /employer.html is dead — always redirects to the app', /app\.resumetailored\.com\/employer/.test(c2.left || ''), c2.hops.join(' | '));
  for (const [u, re, label] of [['/free-ats-resume-checker', /no (account|sign-?up)/i, 'ATS checker landing'], ['/ats-score-checker', /no sign-?up/i, 'ATS score checker'], ['/tools/mock-interview', /1 (free )?mock interview a month|1 mock interview a month/i, 'mock-interview page']]) {
    const t = await (await ctx.request.get(base + u)).text();
    check(`A5/A4 ${label}: stale claim removed`, !re.test(t));
  }
  const fe = await (await ctx.request.get(base + '/for-employers')).text();
  check('A6 for-employers says 1 active job post', /1 active job post/.test(fe) && !/2 job posts/.test(fe));
  await ctx.close(); srv.close();

  // ───────────── Part B: app components ─────────────
  await buildHarness(out);
  const hs = await serveDir(out); const hb = `http://127.0.0.1:${hs.address().port}`;
  async function open(caseName, w = 1000, vw = 1280, setup) {
    const c = await browser.newContext({ viewport: { width: vw, height: 900 } });
    const p = await c.newPage();
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      /employer\/team/.test(r.request().url()) ? { team: [{ id: 1, email: 'owner@account', role: 'owner', status: 'active' }] } : {}) }));
    if (setup) await setup(c, p);
    await p.goto(`${hb}/harness.html?case=${caseName}&w=${w}`);
    await p.waitForFunction(() => window.__ready === true); await p.waitForTimeout(150);
    return { c, p, errors };
  }
  const links = p => p.$$eval('#case a', as => as.map(a => a.getAttribute('href')));
  const allCheckout = (ls, plan) => ls.length > 0 && ls.filter(h => /for-employers|^https?:\/\/resumetailored\.com\/?$/.test(h)).length === 0 && ls.some(h => h === `/employer-checkout?plan=${plan}`);

  let h = await open('banner-portal'); let ls = await links(h.p);
  check('B1 locked banner (Portal-gated) CTA → checkout?plan=portal', allCheckout(ls, 'portal'), JSON.stringify(ls)); await h.c.close();
  h = await open('banner'); ls = await links(h.p);
  check('B1 locked banner (Scale-gated) CTA → checkout?plan=scale', allCheckout(ls, 'scale'), JSON.stringify(ls));
  await h.c.close();
  h = await open('tiernote'); ls = await links(h.p); check('B1 tier-upgrade note → checkout?plan=scale', allCheckout(ls, 'scale'), JSON.stringify(ls)); await h.c.close();
  h = await open('quota'); ls = await links(h.p);
  check('B1 quota bar CTA → checkout?plan=portal', allCheckout(ls, 'portal'), JSON.stringify(ls));
  const qtxt = await h.p.$eval('#case', e => e.textContent);
  check('B7 over-limit counter reads "3 of 3", never "7 of 3"', /3 of 3/.test(qtxt) && !/7 of 3/.test(qtxt), qtxt.slice(0, 120)); await h.c.close();
  h = await open('snackbar'); ls = await links(h.p); check('B1 first-touch snackbar link → checkout?plan=scale', allCheckout(ls, 'scale'), JSON.stringify(ls)); await h.c.close();
  h = await open('sidebar-free', 300); ls = await links(h.p);
  check('B1 sidebar plan footer (Free) → checkout?plan=portal', ls.includes('/employer-checkout?plan=portal'), JSON.stringify(ls.filter(x => /checkout|resumetailored/.test(x))));
  const sb = await h.p.$eval('#case', e => e.textContent);
  check('B7 sidebar counter clamps to "3 of 3"', /3 of 3 sends used/.test(sb) && !/7 of 3/.test(sb)); 
  check('B22 employer nav says "Jobs", not "Hire"', />?Jobs/.test(sb) && !/Hire/.test(sb), sb.slice(0, 160)); await h.c.close();
  h = await open('sidebar-portal', 300); ls = await links(h.p);
  check('B1 sidebar plan footer (Portal) → checkout?plan=scale', ls.includes('/employer-checkout?plan=scale')); await h.c.close();
  h = await open('gate'); ls = await links(h.p); check('B1 full-page employer gate → checkout (not marketing)', allCheckout(ls, 'portal'), JSON.stringify(ls)); await h.c.close();

  // #19 banner wrap — at phone and desktop widths nothing is clipped / overflowing
  for (const [w, label] of [[340, '340px'], [390, '390px'], [900, '900px']]) {
    h = await open('banner', w, Math.max(w + 40, 360));
    const m = await h.p.$eval('#case > div', box => {
      const p = box.querySelector('p'), a = box.querySelector('a'), b = box.getBoundingClientRect(), pr = p.getBoundingClientRect(), ar = a.getBoundingClientRect();
      return { overflowX: box.scrollWidth > box.clientWidth + 1, textClipped: p.scrollHeight > p.clientHeight + 1 || pr.right > b.right + 1, btnInside: ar.right <= b.right + 1 && ar.left >= b.left - 1, boxW: b.width, pW: pr.width, squeezed: pr.width < 200, boxH: b.height, pH: pr.height };
    });
    check(`B19 locked banner copy fully visible and not squeezed beside the button at ${label}`, !m.overflowX && !m.textClipped && m.btnInside && !m.squeezed, JSON.stringify(m));
    await h.p.screenshot({ path: path.join(out, `banner-${w}.png`) }); await h.c.close();
  }

  // #16 Select
  for (const w of [300, 360, 700]) {
    h = await open('select', w, Math.max(w + 40, 360));
    const m = await h.p.$eval('select', s => { const r = s.getBoundingClientRect(), p = s.parentElement.getBoundingClientRect(), cs = getComputedStyle(s); return { inside: r.right <= p.right + 1 && r.left >= p.left - 1, w: r.width, h: r.height, scheme: cs.colorScheme, color: cs.color, truncate: cs.textOverflow, pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
    check(`B16 Select fits its container, dark scheme, truncates long titles at ${w}px`, m.inside && !m.pageOverflow && /dark/.test(m.scheme) && m.truncate === 'ellipsis' && m.h >= 36, JSON.stringify(m));
    await h.p.screenshot({ path: path.join(out, `select-${w}.png`) }); await h.c.close();
  }

  // #2 Office banner
  h = await open('office-free', 1000); let txt = await h.p.$eval('#case', e => e.textContent); ls = await links(h.p);
  check('B2 Office (Free/Portal) shows the standard gated banner', /is part of the Scale plan\. Upgrade to activate/.test(txt) && /Charts, Spreadsheet Creator/.test(txt), txt.slice(0, 200));
  check('B2 Office banner CTA → checkout?plan=scale', ls.includes('/employer-checkout?plan=scale'), JSON.stringify(ls)); await h.c.close();
  h = await open('office-scale', 1000); txt = await h.p.$eval('#case', e => e.textContent);
  check('B2 Office has no banner on Scale', !/is part of the Scale plan/.test(txt)); await h.c.close();

  // #20 Team seat guard
  h = await open('team', 1000);
  await h.p.waitForSelector('text=Account owner', { timeout: 3000 }).then(() => check('B33 team row shows "Account owner" instead of owner@account', true), () => check('B33 team row shows "Account owner" instead of owner@account', false));
  await h.p.click('button:has-text("Invite")'); await h.p.waitForTimeout(200);
  const dlg = await h.p.evaluate(() => document.body.textContent);
  check('B20 at the seat limit, Invite opens the upgrade guardrail', /Inviting requires an upgrade/.test(dlg));
  const hasEmail = await h.p.$('input[type="email"], input[placeholder*="@"]');
  check('B20 …and NOT the normal invite form', !hasEmail);
  const gl = await h.p.$$eval('a', as => as.map(a => a.getAttribute('href')));
  check('B20 guardrail upgrade link → checkout', gl.includes('/employer-checkout?plan=portal'), JSON.stringify(gl)); await h.c.close();

  // #24 Settings plan panel
  h = await open('settings-free', 900); txt = await h.p.$eval('#case', e => e.textContent); ls = await links(h.p);
  check('B24 Settings → Plan: no "Employerplan" run-on, shows current plan + billing + manage link', !/Employerplan/.test(txt) && /Current plan: Free/.test(txt) && /Billing is managed on resumetailored\.com/.test(txt) && /Manage billing/.test(txt), txt.slice(txt.indexOf('Plan'), txt.indexOf('Plan') + 160));
  check('B24 Settings upgrade link → checkout?plan=portal', ls.includes('/employer-checkout?plan=portal'), JSON.stringify(ls.filter(x => /checkout/.test(x)))); await h.c.close();
  h = await open('settings-scale', 900); ls = await links(h.p);
  check('B24 Settings on Scale upsells Corporate', ls.includes('/employer-checkout?plan=corporate')); await h.c.close();

  // #25 preview banner stays in sync with the cookie
  h = await open('preview', 900, 1280, async c => { await c.addCookies([{ name: 'rt_plan_preview', value: encodeURIComponent('candidate:pro'), url: hb }]); });
  let b1 = await h.p.$eval('#case', e => e.textContent);
  check('B25 banner shows the active preview', /Previewing as Pro/.test(b1), b1);
  await h.c.clearCookies(); await h.p.evaluate(() => window.dispatchEvent(new Event('rt-plan-preview-change'))); await h.p.waitForTimeout(150);
  b1 = await h.p.$eval('#case', e => e.textContent);
  check('B25 banner clears when the preview state is gone (no stale "Pro Candidate")', b1.trim() === '', JSON.stringify(b1));
  await h.c.addCookies([{ name: 'rt_plan_preview', value: encodeURIComponent('candidate:free'), url: hb }]);
  await h.p.evaluate(() => window.dispatchEvent(new Event('focus'))); await h.p.waitForTimeout(150);
  b1 = await h.p.$eval('#case', e => e.textContent);
  check('B25 banner follows a change on tab focus', /Previewing as Free/.test(b1), b1); await h.c.close();

  // #23 PRO badges
  h = await open('cand-free', 300); txt = await h.p.$eval('#case', e => e.textContent);
  const nFree = await h.p.$$eval('#case span', s => s.filter(x => x.textContent.trim().toUpperCase() === 'PRO' && /rounded-full/.test(x.className)).length); await h.c.close();
  h = await open('cand-pro', 300); const nPro = await h.p.$$eval('#case span', s => s.filter(x => x.textContent.trim().toUpperCase() === 'PRO' && /rounded-full/.test(x.className)).length); await h.c.close();
  check('B23 Free sees PRO pills on Resume Video / Personal Website', nFree >= 2, `free=${nFree}`);
  check('B23 Pro sees no PRO pills on unlocked tools', nPro === 0, `pro=${nPro}`);

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${out}`);
  console.log(failed.length ? 'FAILURES:\n' + failed.map(f => ' - ' + f.name).join('\n') : 'ALL PASS');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
