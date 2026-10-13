#!/usr/bin/env node
/**
 * Bundle guard for the lazy resume viewer (npm run check:bundle — run AFTER `npm run build`).
 *
 * The brief: PDF.js must never be in the main bundle, and adding the viewer must move the main bundle by ~0.
 * Both are asserted against the real build output in .next/:
 *
 *  1. PDF.js is not in ANY route's initial JavaScript (every app route, every pages-router entry, the root main
 *     files and the polyfills): no initial chunk contains PDF.js's code. This is the hard guarantee.
 *  2. The check is not vacuous: PDF.js IS in the build, in a chunk that no route loads up front (so "absent" can
 *     never be the result of the code having been dropped or renamed past the marker).
 *  3. The main bundle (root main files + polyfills, gzipped) is within 0.5% of scripts/bundle-baseline.json, and
 *     /employer/candidates' first-load JS grew by no more than 2 KB gzipped — the dynamic-import wrapper, nothing
 *     more. The baseline was measured on the commit this feature branched from; refresh it deliberately with
 *     `node scripts/check-bundle-size.cjs --update` when an unrelated change legitimately moves the main bundle.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
// `--baseline-from <dir>` measures ANOTHER checkout's build (the commit before the feature) and writes the baseline from
// it; the PDF.js assertions are skipped there because that build has no viewer.
const fromIdx = process.argv.indexOf("--baseline-from");
const BASELINE_FROM = fromIdx > -1 ? path.resolve(process.argv[fromIdx + 1]) : null;
const NEXT = BASELINE_FROM ? path.join(BASELINE_FROM, ".next") : path.join(ROOT, ".next");
const BASELINE = path.join(__dirname, "bundle-baseline.json");
const UPDATE = process.argv.includes("--update") || !!BASELINE_FROM;
const MAIN_TOLERANCE = 0.005;
const ROUTE_TOLERANCE_BYTES = 2048;
const ROUTE = "/employer/candidates/page";

// Strings that only exist in PDF.js's code, and survive minification (public API names).
const MARKERS = ["GlobalWorkerOptions", "PDFWorker", "getDocument"];

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) console.log("PASS ", name);
  else { failures++; console.error("FAIL ", name, detail !== undefined ? "— " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""); }
};

if (!fs.existsSync(path.join(NEXT, "build-manifest.json"))) {
  console.error("No .next build found — run `npm run build` first.");
  process.exit(1);
}
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const build = readJson(path.join(NEXT, "build-manifest.json"));
const app = fs.existsSync(path.join(NEXT, "app-build-manifest.json")) ? readJson(path.join(NEXT, "app-build-manifest.json")) : { pages: {} };

const file = (rel) => path.join(NEXT, rel);
const gz = (rel) => (fs.existsSync(file(rel)) ? zlib.gzipSync(fs.readFileSync(file(rel)), { level: 9 }).length : 0);
const isJs = (rel) => rel.endsWith(".js");
const sum = (rels) => [...new Set(rels)].filter(isJs).reduce((n, r) => n + gz(r), 0);

const mainFiles = [...build.rootMainFiles, ...build.polyfillFiles];
const initialByRoute = {};
for (const [route, files] of Object.entries(app.pages)) initialByRoute[route] = [...new Set([...mainFiles, ...files])].filter(isJs);
for (const [route, files] of Object.entries(build.pages || {})) initialByRoute[`pages:${route}`] = [...new Set([...mainFiles, ...files])].filter(isJs);

// ── 1 + 2: where is PDF.js? ──
const chunkDir = path.join(NEXT, "static", "chunks");
const allChunks = [];
(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}/${e.name}`);
    else if (e.name.endsWith(".js")) allChunks.push(`${rel}/${e.name}`);
  }
})(chunkDir, "static/chunks");
const hasPdfjs = (rel) => { const src = fs.readFileSync(file(rel), "utf8"); return MARKERS.every((m) => src.includes(m)); };
const pdfjsChunks = allChunks.filter(hasPdfjs);
if (!BASELINE_FROM) check("PDF.js is in the build (the marker check below is not vacuous)", pdfjsChunks.length >= 1, MARKERS);

const leaks = [];
for (const [route, files] of Object.entries(initialByRoute)) for (const f of files) if (pdfjsChunks.includes(f)) leaks.push(`${route} -> ${f}`);
if (!BASELINE_FROM) check(`PDF.js is in NO route's initial JavaScript (${Object.keys(initialByRoute).length} routes + root main files + polyfills checked)`, leaks.length === 0, leaks.slice(0, 5));
if (!BASELINE_FROM) check("PDF.js is not in the root main files or polyfills", !mainFiles.some((f) => pdfjsChunks.includes(f)), mainFiles.filter((f) => pdfjsChunks.includes(f)));
const kb = (n) => (n / 1024).toFixed(1) + " kB";
console.log(`      PDF.js lives in ${pdfjsChunks.length} lazy chunk(s): ${pdfjsChunks.map((c) => `${path.basename(c)} (${kb(gz(c))} gz)`).join(", ")}`);

// ── 3: the main bundle did not move ──
const measured = { mainBundleGzipBytes: sum(mainFiles), candidatesFirstLoadGzipBytes: sum(initialByRoute[ROUTE] || []) };
check(`${ROUTE} exists in the build`, !!initialByRoute[ROUTE]);
console.log(`      main bundle ${kb(measured.mainBundleGzipBytes)} gz · ${ROUTE} first load ${kb(measured.candidatesFirstLoadGzipBytes)} gz`);

if (UPDATE) {
  fs.writeFileSync(BASELINE, JSON.stringify({ measuredBy: BASELINE_FROM ? "scripts/check-bundle-size.cjs --baseline-from <build of the commit this feature branched from: e5ebab9>" : "scripts/check-bundle-size.cjs --update", note: "gzip level 9 over .next initial chunks; refresh only for a deliberate, reviewed change to the main bundle", ...measured }, null, 1) + "\n");
  console.log("wrote scripts/bundle-baseline.json");
} else if (!fs.existsSync(BASELINE)) {
  check("scripts/bundle-baseline.json exists", false, "run: node scripts/check-bundle-size.cjs --update");
} else {
  const base = readJson(BASELINE);
  const mainDelta = (measured.mainBundleGzipBytes - base.mainBundleGzipBytes) / base.mainBundleGzipBytes;
  check(`main bundle delta is ~0 (${(mainDelta * 100).toFixed(2)}%, limit ±${MAIN_TOLERANCE * 100}%)`, Math.abs(mainDelta) <= MAIN_TOLERANCE, { baseline: base.mainBundleGzipBytes, now: measured.mainBundleGzipBytes });
  const routeDelta = measured.candidatesFirstLoadGzipBytes - base.candidatesFirstLoadGzipBytes;
  check(`${ROUTE} first load grew by ${routeDelta} bytes gz (limit ${ROUTE_TOLERANCE_BYTES}) — the dynamic-import wrapper, not the viewer`, routeDelta <= ROUTE_TOLERANCE_BYTES, { baseline: base.candidatesFirstLoadGzipBytes, now: measured.candidatesFirstLoadGzipBytes });
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nALL PASS");
