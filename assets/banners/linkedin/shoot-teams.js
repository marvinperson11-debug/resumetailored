const { chromium } = require('playwright-core');
const path = require('path');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox','--force-color-profile=srgb'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(__dirname, 'teams-landing.html'), { waitUntil: 'networkidle' });
  try { await page.evaluate(() => document.fonts.ready); } catch {}
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, 'teams-landing.png'), fullPage: true });
  console.log('shot teams-landing.png');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
