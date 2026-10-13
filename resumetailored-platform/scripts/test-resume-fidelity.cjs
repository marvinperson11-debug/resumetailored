#!/usr/bin/env node
/**
 * Resume-viewer fidelity gate (npm run test:resume-fidelity) — the launch condition for the employer
 * resume viewer. A viewer that mangles resumes is worse than no viewer, so the feature ships behind
 * RESUME_VIEWER_ENABLED (lib/resume-viewer-flag.ts) and only turns on when this gate passes.
 *
 * What it does: loads every PDF in fidelity/corpus/ with PDF.js using EXACTLY the options the browser
 * viewer uses (app/employer/components/resume-viewer/pdfjs-config.ts), then judges each document:
 *
 *   load      opens, has pages, page count equals poppler's (an independent reader — manifest `pages`)
 *   text      >= 90% of the expected phrases (taken from the source content the PDF was built from, not
 *             from PDF.js's own output) are found in the extracted text layer. Scans are exempt (no text
 *             layer by design) and instead must render real ink
 *   layout    anchor phrases sit in the expected horizontal band of the right page (columns/sidebars);
 *             every text run is inside the page; <= 2% of text runs overlap another (the signature of
 *             wrong glyph widths from a bad font substitution)
 *   fonts     PDF.js raised no font-load / CMap warnings
 *   render    the page paints to a canvas without throwing, with a plausible amount of ink (not blank,
 *             not a black page)
 *
 * A document that fails ANY check is "mangled". mangled / total must be <= 2%. With 22+ documents that
 * means ZERO failures — one bad resume in twenty-two is already 4.5%.
 *
 * The result is written to fidelity/report.json. This script FAILS when:
 *   - the committed report is stale (it disagrees with what the corpus produces now), or
 *   - RESUME_VIEWER_ENABLED is true while the gate does not pass, or
 *   - the gate is vacuous (a negative control that must be judged mangled is not).
 * A gate that does not pass is NOT a red build while the flag is off — it is the report telling us
 * why the feature is not launching (fidelity/report.json -> failures).
 *
 * Run `npm run fidelity:report` to regenerate the committed report after changing the corpus.
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const FID = path.join(ROOT, "fidelity");
const WRITE = process.argv.includes("--write");
const MAX_MANGLED_RATE = 0.02;
const MIN_DOCS = 20;
// Ink agreement with poppler's paint, after a 2px tolerance for anti-aliasing / hinting. Two independent PDF
// renderers agree on well-formed text to >97%; a wrong glyph, a dropped font or a shifted column falls under 85%.
const MIN_INK_AGREEMENT = 0.85;
// CJK documents: fraction of expected Han characters that must appear in the extracted text. Below 1.0 on purpose —
// Chromium/Skia subset fonts map some glyphs to Kangxi-radical or traditional code points in ToUnicode, so the TEXT
// layer says 戶/長 where the page PAINTS 户/长. The painted page (golden comparison above) is what a recruiter sees
// and what our own annotation layer sits on, so the visual check is the strict one; this only catches a dead CMap.
const MIN_CJK_CHAR_RECALL = 0.7;

// Load the shared TypeScript config the way the other scripts/ tests do.
require.extensions[".ts"] = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  module._compile(out.outputText, filename);
};
const { pdfjsDocOptions } = require(path.join(ROOT, "app/employer/components/resume-viewer/pdfjs-config.ts"));
const flagSrc = fs.readFileSync(path.join(ROOT, "lib/resume-viewer-flag.ts"), "utf8");
const flagOn = /export const RESUME_VIEWER_ENABLED\s*=\s*true\b/.test(flagSrc);

const { inkAgreement } = require("./lib/ink-agreement.cjs");

const norm = (s) => String(s).normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const origLog = console.log;

async function evaluate(pdfjs, createCanvas, loadImage, entry, { cmaps = true, expectOverride } = {}) {
  if (process.env.FID_DEBUG) origLog("..", entry.id);
  const problems = [];
  const warnings = [];
  const sims = [];
  const file = path.join(FID, "corpus", entry.file);
  const opts = pdfjsDocOptions({ base: path.join(ROOT, "node_modules/pdfjs-dist") + "/" });
  if (!cmaps) { delete opts.cMapUrl; opts.cMapPacked = false; }
  // PDF.js reports font and CMap trouble through console.log("Warning: ...") — collect it per document.
  console.log = (...a) => { const m = a.join(" "); if (/^Warning:/.test(m)) warnings.push(m); };
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 1, ...opts, useSystemFonts: false }).promise;
  } catch (e) {
    console.log = origLog;
    return { id: entry.id, ok: false, problems: [`load: ${e.message}`], warnings };
  }
  try {
    if (!doc.numPages) problems.push("load: no pages");
    if (doc.numPages !== entry.pages) problems.push(`load: ${doc.numPages} pages, expected ${entry.pages}`);

    const pages = [];
    let totalInk = 0;
    let inkPages = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const [x0, y0, x1, y1] = page.view;
      const width = x1 - x0;
      const height = y1 - y0;
      const tc = await page.getTextContent();
      const items = tc.items.filter((i) => typeof i.str === "string" && i.str.trim() !== "");
      pages.push({ n, width, height, x0, y0, items });

      // A scan is one big JPEG. @napi-rs/canvas cannot paint PDF.js's decoded image bitmaps in Node (it
      // segfaults or rejects them), so for scans the page is judged on PDF.js's OWN decode of the image —
      // the same pixels the browser would paint — measuring how much of it is ink.
      if (entry.scan) {
        try {
          const ol = await page.getOperatorList();
          let best = 0;
          let found = 0;
          for (let i = 0; i < ol.fnArray.length; i++) {
            if (ol.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
            const name = ol.argsArray[i][0];
            const img = await new Promise((res) => (name.startsWith("g_") ? page.commonObjs.get(name, res) : page.objs.get(name, res)));
            if (!img || !img.data || !img.width || !img.height) continue;
            found++;
            const ch = Math.round(img.data.length / (img.width * img.height));
            let ink = 0;
            for (let k = 0; k < img.data.length; k += ch) if (img.data[k] < 200 || (ch > 2 && (img.data[k + 1] < 200 || img.data[k + 2] < 200))) ink++;
            best = Math.max(best, ink / (img.width * img.height));
          }
          if (!found) problems.push(`render: scan page ${n} decoded no image`);
          else { totalInk += best; inkPages++; if (best < 0.003) problems.push(`render: scan page ${n} decodes blank`); if (best > 0.7) problems.push(`render: scan page ${n} decodes mostly black`); }
        } catch (e) {
          problems.push(`render: scan page ${n} image decode threw: ${String(e.message).slice(0, 90)}`);
        }
        continue;
      }
      // render to a canvas and measure ink
      if (entry.render === "text-only") continue;
      try {
        await page.getOperatorList();
        const vp = page.getViewport({ scale: 1 });
        const cv = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cv.width, cv.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
        let ink = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i] < 200 || px[i + 1] < 200 || px[i + 2] < 200) ink++;
        const cover = ink / (cv.width * cv.height);
        if (entry.golden) {
          const g = await loadImage(path.join(FID, "golden", `${entry.id}-${n}.png`));
          const gc = createCanvas(g.width, g.height);
          const gx = gc.getContext("2d");
          gx.drawImage(g, 0, 0);
          const gp = gx.getImageData(0, 0, g.width, g.height).data;
          if (g.width !== cv.width || g.height !== cv.height) problems.push(`render: page ${n} is ${cv.width}x${cv.height}, poppler's is ${g.width}x${g.height}`);
          else {
            const a = new Uint8Array(cv.width * cv.height);
            const b = new Uint8Array(cv.width * cv.height);
            for (let i = 0; i < a.length; i++) { a[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2] < 160 ? 1 : 0; b[i] = gp[i * 4] < 160 ? 1 : 0; }
            const { recall, precision } = inkAgreement(a, b, cv.width, cv.height, 2);
            sims.push({ page: n, recall, precision });
            if (recall < MIN_INK_AGREEMENT || precision < MIN_INK_AGREEMENT)
              problems.push(`render: page ${n} differs from poppler's paint (ink recall ${(recall * 100).toFixed(0)}%, precision ${(precision * 100).toFixed(0)}%, need ${MIN_INK_AGREEMENT * 100}%)`);
          }
        }
        totalInk += cover;
        inkPages++;
        if (cover < 0.003) problems.push(`render: page ${n} is blank (ink ${(cover * 100).toFixed(2)}%)`);
        if (cover > 0.7) problems.push(`render: page ${n} is mostly black (ink ${(cover * 100).toFixed(0)}%)`);
      } catch (e) {
        problems.push(`render: page ${n} threw: ${String(e.message).slice(0, 90)}`);
      }
    }

    const allText = norm(pages.flatMap((p) => p.items.map((i) => i.str)).join(" "));
    const expected = expectOverride || entry.expectText;
    if (entry.scan) {
      if (allText.length > 40) problems.push("scan: unexpectedly has a text layer");
      if (inkPages && totalInk / inkPages < 0.01) problems.push("scan: page renders with almost no ink");
    } else {
      if (!allText.length) problems.push("text: no text layer extracted");
      const isHan = (ph) => /[\u3400-\u9fff]/.test(ph);
      const missing = expected.filter((ph) => !allText.includes(norm(ph)));
      const latin = expected.filter((ph) => !isHan(ph));
      const latinMissing = latin.filter((ph) => !allText.includes(norm(ph)));
      const latinRecall = latin.length ? (latin.length - latinMissing.length) / latin.length : 1;
      if (latinRecall < 0.9) problems.push(`text: recall ${(latinRecall * 100).toFixed(0)}% — missing ${latinMissing.slice(0, 4).map((m) => JSON.stringify(m)).join(", ")}`);
      const hanChars = [...new Set(expected.filter(isHan).join("").normalize("NFKC").replace(/[^\u3400-\u9fff]/g, ""))];
      if (hanChars.length) {
        const have = new Set(allText);
        const hanMissing = hanChars.filter((c) => !have.has(c));
        const hanRecall = (hanChars.length - hanMissing.length) / hanChars.length;
        if (hanRecall < MIN_CJK_CHAR_RECALL) problems.push(`text: only ${(hanRecall * 100).toFixed(0)}% of the expected Han characters were extracted (missing ${hanMissing.slice(0, 6).join("")})`);
      }

      for (const a of entry.anchors || []) {
        const pg = pages[a.page - 1];
        const want = norm(a.text);
        const hit = pg && pg.items.find((i) => norm(i.str).includes(want.slice(0, Math.min(want.length, 10))));
        if (!hit) { problems.push(`layout: anchor ${JSON.stringify(a.text)} not found on page ${a.page}`); continue; }
        const rel = (hit.transform[4] - pg.x0) / pg.width;
        if (rel < a.band[0] - 0.02 || rel > a.band[1] + 0.02) problems.push(`layout: ${JSON.stringify(a.text)} at x=${rel.toFixed(2)} outside column band ${a.band.join("–")}`);
      }
      for (const pg of pages) {
        const outside = pg.items.filter((i) => i.transform[4] < pg.x0 - 4 || i.transform[4] > pg.x0 + pg.width + 4 || i.transform[5] < pg.y0 - 4 || i.transform[5] > pg.y0 + pg.height + 4);
        if (outside.length) problems.push(`layout: ${outside.length} text run(s) outside page ${pg.n}`);
        const boxes = pg.items.filter((i) => i.width > 0 && i.height > 0).map((i) => ({ x: i.transform[4], y: i.transform[5], w: i.width, h: i.height }));
        let overlapping = 0;
        for (let a = 0; a < boxes.length; a++) {
          for (let b = a + 1; b < boxes.length; b++) {
            const A = boxes[a], B = boxes[b];
            const ix = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
            const iy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
            if (ix > 0 && iy > 0 && ix * iy > 0.5 * Math.min(A.w * A.h, B.w * B.h)) { overlapping++; break; }
          }
        }
        if (boxes.length && overlapping / boxes.length > 0.02) problems.push(`layout: ${overlapping}/${boxes.length} text runs overlap on page ${pg.n}`);
      }
    }
    const fontWarn = warnings.filter((w) => /font|cmap|glyph/i.test(w));
    if (fontWarn.length) problems.push(`fonts: ${fontWarn.length} warning(s), e.g. ${fontWarn[0].slice(0, 100)}`);
  } finally {
    console.log = origLog;
    await doc.destroy().catch(() => {});
  }
  return { id: entry.id, ok: problems.length === 0, problems, warnings: warnings.length, ink: sims.length ? Math.min(...sims.map((x) => Math.min(x.recall, x.precision))) : null };
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(FID, "manifest.json"), "utf8"));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // PDF.js polyfills Path2D/DOMMatrix from the @napi-rs/canvas it resolves relative to ITSELF (its own
  // optionalDependency, nested in node_modules/pdfjs-dist). A canvas from any other copy hands it paths it
  // rejects, so resolve ours from the same place — there is deliberately no separate devDependency.
  const pdfjsDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const { createCanvas, loadImage } = require(require.resolve("@napi-rs/canvas", { paths: [pdfjsDir] }));

  let failures = 0;
  const check = (name, ok, detail) => {
    if (ok) console.log("PASS ", name);
    else { failures++; console.error("FAIL ", name, detail !== undefined ? "— " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""); }
  };

  // ── corpus shape: what the brief requires ──
  const families = new Set(manifest.map((m) => m.family));
  const zh = manifest.filter((m) => /zh/.test(m.lang));
  check(`corpus: ${manifest.length} documents (>= ${MIN_DOCS})`, manifest.length >= MIN_DOCS);
  check("corpus: Word-, Google-Docs-, Canva-style, non-embedded-font and scanned documents are all present", ["word", "gdocs", "canva", "nonembed", "scan"].every((f) => families.has(f)), [...families]);
  check(`corpus: at least 3 Chinese-language resumes (${zh.length})`, zh.length >= 3);
  check("corpus: at least one scan and one non-embedded Chinese font", manifest.some((m) => m.scan) && manifest.some((m) => m.family === "nonembed" && m.lang === "zh"));
  check("corpus: every manifest entry has its PDF, and every PDF has an entry", (() => {
    const onDisk = fs.readdirSync(path.join(FID, "corpus")).filter((f) => f.endsWith(".pdf")).sort();
    return JSON.stringify(onDisk) === JSON.stringify(manifest.map((m) => m.file).sort());
  })());

  // ── judge every document ──
  const results = [];
  for (const entry of manifest) results.push({ ...(await evaluate(pdfjs, createCanvas, loadImage, entry)), family: entry.family, lang: entry.lang });
  for (const r of results) console.log(`  ${r.ok ? "ok    " : "MANGLED"} ${r.id}${r.ok ? "" : "\n          - " + r.problems.join("\n          - ")}`);
  const mangled = results.filter((r) => !r.ok);
  const rate = mangled.length / results.length;
  const passed = rate <= MAX_MANGLED_RATE && results.length >= MIN_DOCS;
  console.log(`\nfidelity: ${results.length - mangled.length}/${results.length} documents render faithfully — mangled rate ${(rate * 100).toFixed(1)}% (limit ${(MAX_MANGLED_RATE * 100).toFixed(0)}%) -> gate ${passed ? "PASSES" : "FAILS"}`);

  // ── negative controls: the gate must be able to say no ──
  const byId = Object.fromEntries(manifest.map((m) => [m.id, m]));
  const wrong = await evaluate(pdfjs, createCanvas, loadImage, byId["word-single-column"], { expectOverride: ["this sentence is not in the document", "neither is this one"] });
  check("control: a document whose expected text is absent is judged mangled", !wrong.ok);
  const noCmap = await evaluate(pdfjs, createCanvas, loadImage, byId["nonembedded-zh-stsong"], { cmaps: false });
  check("control: a non-embedded Chinese font WITHOUT the CMaps is judged mangled (so the CMap assets are doing real work)", !noCmap.ok, noCmap.problems);
  const swapped = await evaluate(pdfjs, createCanvas, loadImage, { ...byId["word-single-column"], id: "word-sidebar-table", pages: 1 });
  check("control: a page that paints differently from its reference render (wrong golden) is judged mangled", !swapped.ok, swapped.problems);
  const broken = { id: "broken", file: "word-single-column.pdf", pages: 9, expectText: [], anchors: [] };
  const brokenRes = await evaluate(pdfjs, createCanvas, loadImage, broken);
  check("control: a page-count mismatch is judged mangled", !brokenRes.ok);

  // ── report ──
  const report = {
    generatedBy: "scripts/test-resume-fidelity.cjs",
    pdfjsVersion: require(path.join(ROOT, "node_modules/pdfjs-dist/package.json")).version,
    limit: MAX_MANGLED_RATE,
    total: results.length,
    mangled: mangled.length,
    mangledRate: Number(rate.toFixed(4)),
    passed,
    byFamily: Object.fromEntries([...families].map((f) => [f, { total: results.filter((r) => r.family === f).length, mangled: mangled.filter((r) => r.family === f).length }])),
    minInkAgreement: Number(Math.min(...results.filter((r) => r.ink !== null).map((r) => r.ink)).toFixed(3)),
    failures: mangled.map((r) => ({ id: r.id, problems: r.problems })),
    textOnlyInNodeGate: manifest.filter((m) => m.render === "text-only").map((m) => m.id),
    corpusProvenance: "22 structural stand-ins with fictional people (Word-style via LibreOffice, Google-Docs-style via Chromium/Skia, Canva-style and non-embedded-font via reportlab, rasterised scans via poppler+Pillow). No genuine Word/Canva/Google Docs exports were obtainable in the build sandbox — add real exports before enabling. See fidelity/README.md.",
    flag: "lib/resume-viewer-flag.ts RESUME_VIEWER_ENABLED must stay false until a corpus with real exports passes.",
  };
  const reportPath = path.join(FID, "report.json");
  if (WRITE) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 1) + "\n");
    console.log("wrote fidelity/report.json");
  } else {
    const committed = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, "utf8")) : null;
    check("report: fidelity/report.json matches this run (rerun `npm run fidelity:report` after changing the corpus, PDF.js, or the viewer config)",
      !!committed && committed.passed === report.passed && committed.total === report.total && committed.mangled === report.mangled && committed.pdfjsVersion === report.pdfjsVersion && JSON.stringify(committed.failures.map((f) => f.id)) === JSON.stringify(report.failures.map((f) => f.id)),
      committed ? { committed: { passed: committed.passed, total: committed.total, mangled: committed.mangled, v: committed.pdfjsVersion }, now: { passed: report.passed, total: report.total, mangled: report.mangled, v: report.pdfjsVersion } } : "missing");
  }
  check("flag: RESUME_VIEWER_ENABLED is off, or the gate passes (the feature can never ship while resumes get mangled)", !flagOn || passed, { flagOn, passed, mangled: mangled.map((m) => m.id) });
  check("flag: while the corpus has no real exports the flag stays off (enable only after adding some — fidelity/README.md)", !flagOn || report.total > 0 && manifest.some((m) => m.real));

  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log("\nALL PASS" + (passed ? "" : " (gate itself FAILS — the viewer stays behind its flag; see fidelity/report.json)"));
})().catch((e) => { console.error(e); process.exit(1); });
