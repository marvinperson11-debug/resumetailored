const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 900, deviceScaleFactor: 2 });
  const filePath = 'file://' + path.resolve('/home/user/resumetailor/public/linkedin-comparison.html');
  await page.goto(filePath, { waitUntil: 'networkidle0' });
  const card = await page.$('.card');
  await card.screenshot({ path: '/home/user/resumetailor/public/linkedin-comparison.png' });
  await browser.close();
  console.log('Done');
})().catch(e => { console.error(e); process.exit(1); });
