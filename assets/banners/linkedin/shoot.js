const { chromium } = require('playwright-core');
const path = require('path');

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DIR = __dirname;
const jobs = [
  { file: 'square-bold.html',      w: 1080, h: 1080, out: 'square-bold-1080x1080.png' },
  { file: 'square-editorial.html', w: 1080, h: 1080, out: 'square-editorial-1080x1080.png' },
  { file: 'link-gradient.html',    w: 1200, h: 627,  out: 'link-post-1200x627.png' },
  { file: 'profile-banner.html',   w: 1584, h: 396,  out: 'profile-banner-1584x396.png' },
  { file: 'story-showcase.html',   w: 1080, h: 1920, out: 'story-1080x1920.png' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox','--force-color-profile=srgb'] });
  for (const j of jobs) {
    const page = await browser.newPage({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 2 });
    await page.goto('file://' + path.join(DIR, j.file), { waitUntil: 'networkidle' });
    try { await page.evaluate(() => document.fonts.ready); } catch {}
    await page.waitForTimeout(400);
    const el = await page.$('.stage');
    await el.screenshot({ path: path.join(DIR, j.out) });
    console.log('shot', j.out, `${j.w}x${j.h} @2x`);
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
