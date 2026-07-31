#!/usr/bin/env node
/**
 * Regenerates the tiny real video clips in this directory. Run by hand — not
 * part of the test suite, and not run automatically by anything:
 *
 *   npm i --no-save playwright-core
 *   node test/fixtures/make-fixtures.js
 *
 * Needs Chromium (the tests that USE these fixtures do not — that's the
 * point). Records real, short clips via MediaRecorder in a headless browser,
 * the same technique test/browser/editor.js uses for its own real-clip tests,
 * so what test/media-video-duration.js parses is genuine container bytes
 * rather than a hand-built one.
 *
 *   clip-long.webm / clip-long.mp4  — ~0.9s, two containers, same content
 *   clip-short.webm                 — ~0.15s
 *
 * These two lengths exist to straddle the 0.5s test cap
 * (MEDIA_MAX_VIDEO_SEC) that test/media-video-duration.js sets for itself —
 * not the real 120s production default, which would make every test run
 * record a genuine two-minute clip for no benefit. See that file's header.
 */
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const OUT = __dirname;

async function record(page, durationMs, mime, outName) {
  const b64 = await page.evaluate(async ({ durationMs, mime }) => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 120;
    const g = c.getContext('2d');
    let t = 0;
    const iv = setInterval(() => { g.fillStyle = `hsl(${(t += 15) % 360},70%,50%)`; g.fillRect(0, 0, 160, 120); }, 20);
    const stream = c.captureStream(25);
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });
    rec.start();
    await new Promise((r) => setTimeout(r, durationMs));
    rec.stop(); clearInterval(iv);
    await done;
    const buf = await new Blob(chunks, { type: mime.split(';')[0] }).arrayBuffer();
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }, { durationMs, mime });
  const out = path.join(OUT, outName);
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('wrote', outName, fs.statSync(out).size, 'bytes');
}

(async () => {
  const exe = process.env.CHROME_PATH || undefined;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage();
  await page.goto('about:blank');
  await record(page, 900, 'video/webm;codecs=vp8', 'clip-long.webm');
  await record(page, 900, 'video/mp4', 'clip-long.mp4');
  await record(page, 200, 'video/webm;codecs=vp8', 'clip-short.webm');
  await browser.close();
})();
