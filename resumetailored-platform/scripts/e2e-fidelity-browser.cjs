#!/usr/bin/env node
/**
 * MANUAL real-browser run of the fidelity corpus (not part of CI — it needs Chromium).
 *
 * scripts/test-resume-fidelity.cjs is the CI gate and renders with PDF.js in Node. A recruiter's browser is not Node:
 * it has a real canvas, real system fonts, and can paint a PDF whose fonts are not embedded. This runs the SAME
 * corpus, with the SAME PDF.js build and the SAME document options (app/employer/components/resume-viewer/pdfjs-config.ts),
 * inside real Chromium, and applies the SAME ink-agreement comparison against poppler's golden renders.
 * It is also what lets the one document the Node gate cannot paint (a Chinese resume whose font is not embedded)
 * be judged visually, using the system CJK font — and it saves every rendered page so a human can look.
 *
 *   PLAYWRIGHT_CORE=/path/to/playwright-core CHROME_PATH=/path/to/chrome E2E_OUT=out node scripts/e2e-fidelity-browser.cjs
 *
 * For the Chinese documents to paint, the machine needs a Simplified-Chinese system font (fonts-noto-cjk or similar).
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const ts = require("typescript");
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const { inkAgreement } = require("./lib/ink-agreement.cjs");

const ROOT = path.resolve(__dirname, "..");
const FID = path.join(ROOT, "fidelity");
const PDFJS = path.dirname(require.resolve("pdfjs-dist/package.json"));
const OUT = path.resolve(process.env.E2E_OUT || "out");
fs.mkdirSync(path.join(OUT, "fidelity-browser"), { recursive: true });
const MIN_INK_AGREEMENT = 0.85;

require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
};
const { pdfjsDocOptions } = require(path.join(ROOT, "app/employer/components/resume-viewer/pdfjs-config.ts"));
const pdfjsCreateCanvas = require(require.resolve("@napi-rs/canvas", { paths: [PDFJS] }));

const types = { ".mjs": "text/javascript", ".js": "text/javascript", ".pdf": "application/pdf", ".html": "text/html", ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream", ".ttf": "font/ttf" };
const PAGE = `<!doctype html><meta charset="utf-8"><body><script type="module">
import * as pdfjs from "/lib/pdf.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = "/lib/pdf.worker.min.mjs";
window.renderDoc = async (file, opts) => {
  const doc = await pdfjs.getDocument({ url: "/corpus/" + file, ...opts }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const mask = new Uint8Array(cv.width * cv.height);
    for (let i = 0; i < mask.length; i++) mask[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2] < 160 ? 1 : 0;
    let bin = ""; for (let i = 0; i < mask.length; i += 0x8000) bin += String.fromCharCode.apply(null, mask.subarray(i, i + 0x8000));
    pages.push({ w: cv.width, h: cv.height, mask: btoa(bin), png: cv.toDataURL("image/png") });
  }
  await doc.destroy();
  return pages;
};
window.ready = true;
</script>`;
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = null;
  if (u === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end(PAGE); }
  if (u === "/lib/pdf.mjs") file = path.join(PDFJS, "legacy/build/pdf.mjs");
  else if (u === "/lib/pdf.worker.min.mjs") file = path.join(PDFJS, "legacy/build/pdf.worker.min.mjs");
  else if (u.startsWith("/assets/")) file = path.join(PDFJS, u.slice("/assets/".length));
  else if (u.startsWith("/corpus/")) file = path.join(FID, "corpus", path.basename(u));
  if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(4671, "127.0.0.1", r));
  const manifest = JSON.parse(fs.readFileSync(path.join(FID, "manifest.json"), "utf8"));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const consoleWarnings = [];
  page.on("console", (m) => { if (/Warning:/.test(m.text())) consoleWarnings.push(m.text()); });
  await page.goto("http://127.0.0.1:4671/");
  await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 });
  const opts = pdfjsDocOptions({ base: "/assets/" });

  let mangled = 0;
  for (const m of manifest) {
    const problems = [];
    let pages = [];
    try {
      pages = await page.evaluate(([f, o]) => window.renderDoc(f, o), [m.file, opts]);
    } catch (e) {
      problems.push("render threw: " + String(e.message).split("\n")[0].slice(0, 100));
    }
    if (!problems.length && pages.length !== m.pages) problems.push(`${pages.length} pages, expected ${m.pages}`);
    const detail = [];
    pages.forEach((p, i) => {
      const mask = Buffer.from(p.mask, "base64");
      let ink = 0;
      for (const b of mask) ink += b;
      const cover = ink / mask.length;
      fs.writeFileSync(path.join(OUT, "fidelity-browser", `${m.id}-${i + 1}.png`), Buffer.from(p.png.split(",")[1], "base64"));
      if (cover < 0.003) problems.push(`page ${i + 1} is blank`);
      if (cover > 0.7) problems.push(`page ${i + 1} is mostly black`);
      if (m.golden) {
        return (async () => {})(); // compared below (needs async PNG decode)
      }
      detail.push(`ink ${(cover * 100).toFixed(1)}%`);
    });
    if (m.golden) {
      for (let i = 0; i < pages.length; i++) {
        const g = await pdfjsCreateCanvas.loadImage(path.join(FID, "golden", `${m.id}-${i + 1}.png`));
        const gc = pdfjsCreateCanvas.createCanvas(g.width, g.height);
        const gx = gc.getContext("2d");
        gx.drawImage(g, 0, 0);
        const gp = gx.getImageData(0, 0, g.width, g.height).data;
        if (g.width !== pages[i].w || g.height !== pages[i].h) { problems.push(`page ${i + 1} is ${pages[i].w}x${pages[i].h}, poppler's is ${g.width}x${g.height}`); continue; }
        const a = new Uint8Array(Buffer.from(pages[i].mask, "base64"));
        const b = new Uint8Array(g.width * g.height);
        for (let k = 0; k < b.length; k++) b[k] = gp[k * 4] < 160 ? 1 : 0;
        const { recall, precision } = inkAgreement(a, b, g.width, g.height, 2);
        detail.push(`agree ${(Math.min(recall, precision) * 100).toFixed(0)}%`);
        if (recall < MIN_INK_AGREEMENT || precision < MIN_INK_AGREEMENT) problems.push(`page ${i + 1} differs from poppler (recall ${(recall * 100).toFixed(0)}%, precision ${(precision * 100).toFixed(0)}%)`);
      }
    }
    if (m.scan && pages.length) {
      /* a scan has no golden: the real canvas path decoded the JPEG, and the blank/black checks above cover it */
    }
    if (problems.length) mangled++;
    console.log(`${problems.length ? "MANGLED" : "ok     "} ${m.id.padEnd(34)} ${detail.join(" ")}${problems.length ? "\n         - " + problems.join("\n         - ") : ""}`);
  }
  const fontWarnings = consoleWarnings.filter((w) => /font|cmap|glyph/i.test(w));
  console.log(`\nbrowser: ${manifest.length - mangled}/${manifest.length} documents render faithfully in real Chromium (${fontWarnings.length} font/CMap warnings). Pages saved to ${path.join(OUT, "fidelity-browser")}`);
  await browser.close();
  server.close();
  process.exit(mangled ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
