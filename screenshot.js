const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  // 1920x1080 at deviceScaleFactor 1 = exact LinkedIn article cover size
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const filePath = 'file://' + path.resolve('/home/user/resumetailor/public/linkedin-comparison.html');
  await page.goto(filePath, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: '/home/user/resumetailor/public/linkedin-comparison.png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  await browser.close();
  console.log('Done');
})().catch(e => { console.error(e); process.exit(1); });
