#!/usr/bin/env node
/**
 * WordCraft vs LibreOffice fidelity benchmark (WORDCRAFT_PDF_MODE decision input). NOT part of CI.
 *
 *   node scripts/benchmark-wordcraft.cjs [--fast] [--n 52] [--seed 7] [--out DIR]
 *        [--text-threshold 0.98] [--visual-threshold 0.15] [--pixel-tol 64] [--dpi 72] [--local]
 *
 *   Sidecar: CRAFT_BASE_URL + CRAFT_SHARED_SECRET (e.g. the docker compose one on 127.0.0.1:18080), or --local
 *   to start craft/server.cjs here on the binaries in CRAFT_TOOLS_DIR (node craft/install-tools.cjs --dest DIR).
 *   LibreOffice: the real `soffice` on PATH, through lib/docs/pdf.ts docxToPdf — the production path.
 *
 * Corpus: N synthetic resumes (seeded; fictional names and employers, @example.com — never customer documents)
 * through the EXISTING pipeline: half via generateResume() with a stub model (lib/docs/pipeline.ts), half via
 * the export route's textToResumeDoc() (lib/docs/legacy.ts, the only path with extra sections); all rendered by
 * renderDocument() for the PDF target, so free-tier documents carry the footer watermark. Every 5th is paid.
 * Plus CJK documents, which must be refused by the real CJK guard in exportPdf() (never sent to WordCraft).
 * The renderer emits no tables or images, so those taxonomy buckets can only stay empty (reported as such).
 *
 * Per document, both PDFs go through PdfCraft (sidecar /pdf/preview + /pdf/text) and are compared on: page
 * count; extracted text ("words": case-insensitive multiset similarity, the check — WordCraft keeps the source
 * case of allCaps headings in its text layer, and PdfCraft emits right-aligned dates after each page, so a page
 * break alone reorders tokens; "order": LCS similarity, reported only); rendered pages (ink-normalised pixel diff
 * + a row-profile layout score); file size; embedded font families. ASSERTED (exit 1 on any miss): the free-tier
 * footer line is in BOTH PDFs exactly when tier.ts says so, and the Professional navy is on the same elements in
 * both — navy on page 1, and the same number of navy elements (name + section headings) over the document.
 * Verdict: fidelity rate = % of compared documents passing BOTH the text and the visual check.
 * Taxonomy: when the embedded fonts differ, layout drift is filed under "fonts" (different faces set different
 * line heights); "layout" = the page count changed, or drift with identical fonts.
 * Exit: 0 harness ran (whatever the rate), 1 a watermark/accent assertion failed, 2 infrastructure problem.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");

if (!require.extensions[".ts"]) {
  require.extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
}
const L = (f) => require(path.join(ROOT, f));
const JSZip = require("jszip");

/* ─────────────── comparison helpers (exported; unit-tested in scripts/test-craft.cjs) ─────────────── */

/** Lowercased word tokens; form feeds and all whitespace are separators. */
const tokens = (s) => String(s || "").toLowerCase().normalize("NFC").replace(/(\w)-\s+(?=\w)/g, "$1-").split(/\s+/).filter(Boolean);

/** 2·LCS / (|a|+|b|) over word tokens: 1 = same words in the same order. */
function textSimilarity(a, b) {
  const x = tokens(a), y = tokens(b);
  if (!x.length && !y.length) return 1;
  let prev = new Uint32Array(y.length + 1), cur = new Uint32Array(y.length + 1);
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev];
  }
  return (2 * prev[y.length]) / (x.length + y.length);
}

/**
 * 2·|common words| / (|a|+|b|) as multisets: 1 = no word lost or added, in any order. This is the text check:
 * PdfCraft emits right-aligned dates after each page's body, so a different page break alone reorders tokens.
 */
function wordBagSimilarity(a, b) {
  const x = tokens(a), y = tokens(b);
  if (!x.length && !y.length) return 1;
  const m = new Map();
  for (const w of x) m.set(w, (m.get(w) || 0) + 1);
  let common = 0;
  for (const w of y) { const n = m.get(w) || 0; if (n) { common++; m.set(w, n - 1); } }
  return (2 * common) / (x.length + y.length);
}

/** Words in one text and not the other (multiset), for the report. */
function textDelta(a, b, limit = 12) {
  const count = (t) => t.reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map());
  const ca = count(tokens(a)), cb = count(tokens(b));
  const only = (p, q) => [...p].flatMap(([w, n]) => Array(Math.max(0, n - (q.get(w) || 0))).fill(w)).slice(0, limit);
  return { onlyLibreOffice: only(ca, cb), onlyWordCraft: only(cb, ca) };
}

const gray = (img, i, pixel) => { const [r, g, b] = pixel(img, i); return (r + g + b) / 3; };

/**
 * Pixel diff normalised by INK (a resume page is mostly white, so a raw ratio would call any two resumes
 * "98% identical"): pixels whose gray differs by more than pixelTol, over pixels that are ink in either image.
 */
function visualDiff(a, b, pixel, pixelTol = 64) {
  if (a.width !== b.width || a.height !== b.height) return { comparable: false, ratio: 1 };
  let diff = 0, ink = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    const ga = gray(a, i, pixel), gb = gray(b, i, pixel);
    if (ga < 200 || gb < 200) ink++;
    if (Math.abs(ga - gb) > pixelTol) diff++;
  }
  return { comparable: true, ratio: ink ? diff / ink : 0 };
}

/** Which pixel rows carry ink — the vertical rhythm of a page, insensitive to glyph shapes and fonts. */
function inkRows(img, pixel) {
  const rows = new Uint8Array(img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) if (gray(img, y * img.width + x, pixel) < 200) { rows[y] = 1; break; }
  }
  return rows;
}
/** Jaccard of the two ink-row sets, each row matching within ±slack rows: 1 = lines sit at the same heights. */
function layoutSimilarity(a, b, pixel, slack = 2) {
  const ra = inkRows(a, pixel), rb = inkRows(b, pixel);
  const near = (r, y) => { for (let d = -slack; d <= slack; d++) if (r[y + d]) return true; return false; };
  let both = 0, either = 0;
  for (let y = 0; y < Math.max(ra.length, rb.length); y++) {
    if (!ra[y] && !rb[y]) continue;
    either++;
    if ((ra[y] && near(rb, y)) || (rb[y] && near(ra, y))) both++;
  }
  return either ? both / either : 1;
}

/** Embedded font families ("ABCDEF+Carlito-Bold" -> "Carlito"). Font dictionaries are not compressed. */
function pdfFonts(pdf) {
  const s = pdf.toString("latin1");
  const out = new Set();
  for (const m of s.matchAll(/\/(?:BaseFont|FontName)\s*\/(?:[A-Z]{6}\+)?([A-Za-z0-9]+)/g)) out.add(m[1]);
  return [...out].sort();
}

/** Seeded PRNG (mulberry32) so a run is reproducible from --seed. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ─────────────── synthetic corpus (fictional people and employers only) ─────────────── */

const FIRST = ["Avery", "Jordan", "Riley", "Morgan", "Casey", "Quinn", "Rowan", "Sasha", "Devon", "Emerson", "Harper", "Kai", "Logan", "Parker", "Reese", "Skyler"];
const FIRST_INTL = ["José", "Zoë", "Søren", "Anaïs", "Björn", "Chloé", "Mateus", "Niamh"];
const LAST = ["Fixture", "Sample", "Testwell", "Placeholder", "Mockingham", "Synthwood", "Demoreau", "Exampleton", "Specimen", "Stubbs"];
const LAST_INTL = ["Müller-Øster", "O'Sample", "García-Demo", "Ðoković-Test", "Ångström"];
const EMPLOYERS = ["Northwind Freight", "Contoso Logistics", "Fabrikam Health", "Globex Analytics", "Initech Systems", "Tailspin Air", "Wingtip Toys", "Litware Labs", "Adventure Works", "Proseware Inc", "Woodgrove Bank", "Lucerne Publishing", "Coho Winery", "Alpine Ski House", "Fourth Coffee", "Margie's Travel"];
const EMPLOYERS_SPECIAL = ["R&D Partners", "Smith & Sons Pty Ltd", "Café Ünited", "C#/.NET Guild", "\"Quoted\" Media Co"];
const TITLES = ["Software Engineer", "Senior Data Analyst", "Registered Nurse", "Project Manager", "Marketing Manager", "Financial Analyst", "UX Designer", "Operations Lead", "Civil Engineer", "Account Manager", "DevOps Engineer", "Product Manager", "Pharmacist", "Customer Success Lead"];
const CITIES = ["Portland, OR", "Austin, TX", "Denver, CO", "Raleigh, NC", "Sydney, NSW", "Toronto, ON", "Leeds, UK", "Auckland, NZ"];
const VERBS = ["Led", "Built", "Cut", "Designed", "Launched", "Automated", "Grew", "Reduced", "Negotiated", "Migrated", "Mentored", "Streamlined"];
const OBJECTS = ["the quarterly planning cycle", "a customer onboarding flow", "vendor invoice reconciliation", "the on-call rotation", "a regional sales pipeline", "patient intake scheduling", "the data warehouse", "a 12-person support team", "release automation", "pricing experiments"];
const SKILLS = ["SQL", "Python", "Excel", "Tableau", "Kubernetes", "Figma", "Salesforce", "Forecasting", "Stakeholder management", "Agile", "Go", "TypeScript", "Budgeting", "Patient care", "AutoCAD", "Negotiation", "Spanish (fluent)", "Jira", "AWS", "Power BI"];
const SCHOOLS = ["Oregon State University", "University of Sydney", "Example Technical College", "Northbridge University", "Lakeside Institute"];
const DEGREES = ["BS Industrial Engineering", "BSc Computer Science", "Bachelor of Nursing", "MBA", "BA Economics", "MS Data Science"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "March", "June", "September", "November"];

function makeResume(i, rnd) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const intl = i % 7 === 3;
  const name = `${intl ? pick(FIRST_INTL) : pick(FIRST)} ${intl ? pick(LAST_INTL) : pick(LAST)}`;
  const email = `${name.toLowerCase().normalize("NFD").replace(/[^a-z ]/g, "").trim().replace(/\s+/g, ".")}@example.com`;
  const contact = [pick(CITIES), email, `+1 555 01${String(between(0, 99)).padStart(2, "0")}`];
  const nExp = between(1, 6);
  const longDoc = i % 6 === 5;
  let year = 2026;
  const experience = [];
  for (let e = 0; e < nExp + (longDoc ? 2 : 0); e++) {
    const end = year;
    const start = end - between(1, 4);
    year = start;
    const fmt = (e + i) % 3;
    const dates = e === 0 && i % 2 === 0 ? `${pick(MONTHS)} ${start} – Present`
      : fmt === 0 ? `${start} – ${end}` : fmt === 1 ? `${pick(MONTHS)} ${start} – ${pick(MONTHS)} ${end}` : `${pick(MONTHS_LONG)} ${start} - ${pick(MONTHS_LONG)} ${end}`;
    const bullets = Array.from({ length: between(1, longDoc ? 7 : 5) }, () => {
      const b = `${pick(VERBS)} ${pick(OBJECTS)}, improving throughput by ${between(5, 60)}% across ${between(2, 14)} teams`;
      return longDoc ? `${b} while keeping the budget flat and documenting every change for the audit committee` : b;
    });
    experience.push({ title: pick(TITLES), company: intl && e === 0 ? pick(EMPLOYERS_SPECIAL) : pick(EMPLOYERS), dates, bullets });
  }
  const summary = `${pick(TITLES)} with ${between(2, 20)} years of experience in ${pick(OBJECTS)} and ${pick(OBJECTS)}.` + (longDoc ? " Known for calm delivery under pressure, clear written updates, and turning ambiguous goals into plans that teams can execute week by week." : "");
  const skills = Array.from(new Set(Array.from({ length: between(3, 16) }, () => pick(SKILLS))));
  const education = Array.from({ length: between(0, 2) || 1 }, () => ({ degree: pick(DEGREES), school: pick(SCHOOLS), dates: String(between(1998, 2020)) }));
  const certifications = i % 4 === 1 ? ["PMP", "AWS Certified Cloud Practitioner"].slice(0, between(1, 2)) : [];
  const extra = i % 3 === 2 ? [{ title: pick(["PROJECTS", "AWARDS", "VOLUNTEERING"]), lines: [`${pick(VERBS)} ${pick(OBJECTS)} (${between(2015, 2025)})`, `${pick(VERBS)} ${pick(OBJECTS)}`] }] : [];
  return { name, contact, summary, experience, skills, education, certifications, extra };
}

/** The resume as the plain text the tailor tools put on screen (what /api/documents/export receives). */
function asPlainText(r) {
  const out = [r.name, r.contact.join(" | "), "", "SUMMARY", r.summary, "", "EXPERIENCE"];
  for (const e of r.experience) out.push(e.title, `${e.company} | ${e.dates}`, ...e.bullets.map((b) => `- ${b}`), "");
  out.push("EDUCATION");
  for (const ed of r.education) out.push(ed.degree, `${ed.school} | ${ed.dates}`);
  out.push("", "SKILLS", r.skills.join(", "));
  if (r.certifications.length) out.push("", "CERTIFICATIONS", ...r.certifications.map((c) => `- ${c}`));
  for (const x of r.extra) out.push("", x.title, ...x.lines.map((l) => `- ${l}`));
  return out.join("\n");
}

const CJK_RESUMES = [
  { name: "王小明", contact: ["上海", "wang.fixture@example.com"], summary: "资深软件工程师，负责支付平台的稳定性与性能。", experience: [{ title: "高级工程师", company: "示例科技有限公司", dates: "2020 – 至今", bullets: ["将接口延迟降低40%"] }], skills: ["Go", "分布式系统"], education: [{ degree: "计算机科学学士", school: "示例大学", dates: "2015" }] },
  { name: "Hana Sample", contact: ["Tokyo", "hana.fixture@example.com"], summary: "プロダクトマネージャーとして8年の経験。", experience: [{ title: "Product Manager", company: "Example KK", dates: "2019 – Present", bullets: ["新機能を3件リリース"] }], skills: ["Roadmapping"], education: [] },
  { name: "Min-jun Fixture", contact: ["Seoul", "minjun.fixture@example.com"], summary: "Data analyst.", experience: [{ title: "데이터 분석가", company: "예시 주식회사", dates: "2021 – Present", bullets: ["Built dashboards"] }], skills: ["SQL"], education: [] },
];

/** Build the corpus through the real pipeline. Returns [{ id, tier, path, docx, features }]. */
async function buildCorpus(n, seed, cjkCount) {
  const { generateResume } = L("lib/docs/pipeline.ts");
  const { renderDocument } = L("lib/docs/docx-render.ts");
  const { textToResumeDoc } = L("lib/docs/legacy.ts");
  const rnd = prng(seed);
  const vacancy = { id: "bench", employer: "Benchmark Employer", position: "Analyst", description: "Synthetic vacancy used only by the WordCraft benchmark." };
  const docs = [];
  for (let i = 0; i < n; i++) {
    const r = makeResume(i, rnd);
    const tier = i % 5 === 4 ? "paid" : "free";
    const via = i % 2 === 0 ? "pipeline" : "export";
    let doc;
    if (via === "pipeline") {
      const profileText = asPlainText(r);
      const stub = async () => JSON.stringify({ name: r.name, contact: r.contact, summary: r.summary, experience: r.experience, skills: r.skills, education: r.education, certifications: r.certifications });
      doc = (await generateResume({ vacancy, profileText, llm: stub })).doc;
    } else {
      doc = textToResumeDoc(asPlainText(r));
    }
    const docx = await renderDocument({ kind: "resume", doc }, { tier, target: "pdf" });
    const features = [
      r.experience.length > 6 || r.experience.reduce((a, e) => a + e.bullets.length, 0) > 18 ? "long" : null,
      i % 7 === 3 ? "special-chars" : null,
      via === "export" && r.extra.length ? "extra-section" : null,
      r.certifications.length ? "certifications" : null,
    ].filter(Boolean);
    docs.push({ id: `r${String(i + 1).padStart(2, "0")}`, tier, path: via, docx, features });
  }
  for (let k = 0; k < cjkCount; k++) {
    const docx = await renderDocument({ kind: "resume", doc: { certifications: [], ...CJK_RESUMES[k % CJK_RESUMES.length] } }, { tier: "free", target: "pdf" });
    docs.push({ id: `cjk${k + 1}`, tier: "free", path: "pipeline-render", docx, features: ["cjk"] });
  }
  return docs;
}

/* ─────────────── harness ─────────────── */

function parseArgs(argv) {
  const a = { n: 52, seed: 7, cjk: 3, textThreshold: 0.98, visualThreshold: 0.15, pixelTol: 64, layoutThreshold: 0.9, dpi: 72, out: null, local: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--fast") { a.n = 5; a.cjk = 1; }
    else if (k === "--local") a.local = true;
    else if (k === "--n") { a.n = Number(v); i++; }
    else if (k === "--seed") { a.seed = Number(v); i++; }
    else if (k === "--cjk") { a.cjk = Number(v); i++; }
    else if (k === "--out") { a.out = v; i++; }
    else if (k === "--text-threshold") { a.textThreshold = Number(v); i++; }
    else if (k === "--visual-threshold") { a.visualThreshold = Number(v); i++; }
    else if (k === "--layout-threshold") { a.layoutThreshold = Number(v); i++; }
    else if (k === "--pixel-tol") { a.pixelTol = Number(v); i++; }
    else if (k === "--dpi") { a.dpi = Number(v); i++; }
    else if (k === "--help" || k === "-h") { console.log(fs.readFileSync(__filename, "utf8").split("*/")[0]); process.exit(0); }
    else { console.error(`unknown argument ${k}`); process.exit(2); }
  }
  return a;
}

async function health(base, secret) {
  try {
    const r = await fetch(`${base}/health`, { headers: { "x-craft-secret": secret }, signal: AbortSignal.timeout(3000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** --local: run craft/server.cjs here, on the binaries installed in CRAFT_TOOLS_DIR. */
async function startLocalSidecar() {
  const home = process.env.CRAFT_TOOLS_DIR;
  if (!home || !fs.existsSync(path.join(home, "bin", "wordcraft-cli"))) throw new Error("--local needs CRAFT_TOOLS_DIR (node craft/install-tools.cjs --dest DIR)");
  const secret = crypto.randomBytes(24).toString("hex");
  const port = 19000 + Math.floor(Math.random() * 900);
  const tmp = fs.mkdtempSync(path.join(process.env.CRAFT_TMP_ROOT || os.tmpdir(), "craft-bench-"));
  const child = spawn(process.execPath, [path.join(ROOT, "craft/server.cjs")], {
    env: { ...process.env, CRAFT_HOME: home, CRAFT_SHARED_SECRET: secret, PORT: String(port), CRAFT_BIND: "127.0.0.1", CRAFT_TMP: tmp },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50 && !(await health(base, secret)); i++) await new Promise((r) => setTimeout(r, 100));
  return { base, secret, stop: () => { child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); } };
}

/** Both PdfCraft views of one PDF: page count, page PNGs, text. */
async function inspectPdf(craftPost, pdf, dpi) {
  const prev = await craftPost("/pdf/preview", pdf, { filename: "d.pdf", mime: "application/pdf", query: { dpi: String(dpi) }, timeoutMs: 30_000 });
  if (prev.kind !== "reached" || prev.status !== 200) throw new Error(`preview: ${prev.kind === "reached" ? prev.code || prev.status : prev.reason}`);
  const pages = Number(prev.headers.get("x-craft-pages"));
  let pngs;
  if ((prev.headers.get("content-type") || "").includes("zip")) {
    const z = await JSZip.loadAsync(prev.body);
    pngs = await Promise.all(Object.keys(z.files).sort().map((n) => z.file(n).async("nodebuffer")));
  } else pngs = [prev.body];
  const txt = await craftPost("/pdf/text", pdf, { filename: "d.pdf", mime: "application/pdf", timeoutMs: 30_000 });
  if (txt.kind !== "reached" || txt.status !== 200) throw new Error(`text: ${txt.kind === "reached" ? txt.code || txt.status : txt.reason}`);
  return { pages, pngs, text: txt.body.toString("utf8") };
}

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const kb = (b) => (b / 1024).toFixed(0);

async function main() {
  const args = parseArgs(process.argv);
  const { docxToPdf, exportPdf } = L("lib/docs/pdf.ts");
  const { craftPost } = L("lib/craft/client.ts");
  const { docxHasCjk } = L("lib/craft/cjk.ts");
  const { decodePng, pixel, accentPixels, accentBands, docxExpectsAccent, ACCENT_MIN_PIXELS } = L("lib/craft/fidelity.ts");
  const { WATERMARK_TEXT, shouldWatermark } = L("lib/docs/tier.ts");

  let local = null;
  if (args.local) {
    try { local = await startLocalSidecar(); } catch (e) { console.error("INFRA", e.message); process.exit(2); }
    process.env.CRAFT_BASE_URL = local.base;
    process.env.CRAFT_SHARED_SECRET = local.secret;
  }
  const base = (process.env.CRAFT_BASE_URL || "").replace(/\/+$/, "");
  const h = await health(base, process.env.CRAFT_SHARED_SECRET || "");
  if (!h) { console.error(`INFRA sidecar not reachable at ${base || "(CRAFT_BASE_URL unset)"} — start it (craft/README.md) or pass --local.`); local?.stop(); process.exit(2); }
  if (spawnSync("soffice", ["--version"], { stdio: "ignore" }).status !== 0) { console.error("INFRA LibreOffice (soffice) not on PATH."); local?.stop(); process.exit(2); }

  const outDir = args.out || path.join(ROOT, "out", "benchmark-wordcraft", new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`WordCraft benchmark — sidecar tools ${JSON.stringify(h.tools)}; ${args.n} resumes + ${args.cjk} CJK; seed ${args.seed}`);
  console.log(`thresholds: text >= ${args.textThreshold}, visual <= ${args.visualThreshold} (pixel tol ${args.pixelTol}), layout >= ${args.layoutThreshold}, ${args.dpi} dpi; artifacts -> ${path.relative(ROOT, outDir)}\n`);

  const corpus = await buildCorpus(args.n, args.seed, args.cjk);
  const rows = [];
  for (const d of corpus) {
    const row = { id: d.id, tier: d.tier, path: d.path, features: d.features, categories: [] };
    rows.push(row);
    const dir = path.join(outDir, d.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "resume.docx"), d.docx);
    const xml = (await (await JSZip.loadAsync(d.docx)).file("word/document.xml").async("string"));
    row.hasTable = /<w:tbl\b/.test(xml);
    row.hasImage = /<w:drawing\b|<w:pict\b/.test(xml);

    if (await docxHasCjk(d.docx)) {
      // The REAL guard: exportPdf in pilot mode must take LibreOffice without calling the sidecar at all.
      let calls = 0, lo = 0;
      const out = await exportPdf(d.docx, { tier: d.tier }, { mode: () => "pilot", craft: async (...a) => { calls++; return craftPost(...a); }, libreoffice: async () => { lo++; return Buffer.from("%PDF-lo"); } });
      row.status = "cjk-guarded";
      row.guardOk = calls === 0 && lo === 1 && String(out) === "%PDF-lo";
      continue;
    }

    const t0 = Date.now();
    const loPdf = await docxToPdf(d.docx);
    row.loMs = Date.now() - t0;
    if (!loPdf) { row.status = "infra"; row.error = "LibreOffice conversion failed"; continue; }
    const t1 = Date.now();
    const wc = await craftPost("/docx/convert", d.docx, { filename: "resume.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", timeoutMs: 30_000 });
    row.wcMs = Date.now() - t1;
    fs.writeFileSync(path.join(dir, "libreoffice.pdf"), loPdf);
    if (wc.kind !== "reached" || wc.status !== 200) {
      row.status = "error";
      row.error = wc.kind === "reached" ? `${wc.status} ${wc.code || ""}`.trim() : wc.reason;
      row.categories.push("error");
      continue;
    }
    const wcPdf = wc.body;
    fs.writeFileSync(path.join(dir, "wordcraft.pdf"), wcPdf);
    let A, B;
    try { [A, B] = [await inspectPdf(craftPost, loPdf, args.dpi), await inspectPdf(craftPost, wcPdf, args.dpi)]; }
    catch (e) { row.status = "error"; row.error = `inspect ${e.message}`; row.categories.push("error"); continue; }

    row.pages = [A.pages, B.pages];
    row.size = [loPdf.length, wcPdf.length];
    row.fonts = [pdfFonts(loPdf), pdfFonts(wcPdf)];
    row.textSim = wordBagSimilarity(A.text, B.text);
    row.orderSim = textSimilarity(A.text, B.text);
    row.textDelta = textDelta(A.text, B.text);
    const imgsA = A.pngs.map(decodePng), imgsB = B.pngs.map(decodePng);
    let worst = 0, layout = 1;
    for (let p = 0; p < Math.min(imgsA.length, imgsB.length); p++) {
      const v = visualDiff(imgsA[p], imgsB[p], pixel, args.pixelTol);
      worst = Math.max(worst, v.ratio);
      if (v.comparable) layout = Math.min(layout, layoutSimilarity(imgsA[p], imgsB[p], pixel));
      else layout = 0;
      fs.writeFileSync(path.join(dir, `lo-p${p + 1}.png`), A.pngs[p]);
      fs.writeFileSync(path.join(dir, `wc-p${p + 1}.png`), B.pngs[p]);
    }
    row.visual = worst;
    row.layout = layout;

    const wmWant = shouldWatermark(d.tier, "pdf");
    const has = (t) => t.replace(/\s+/g, " ").includes(WATERMARK_TEXT);
    row.watermark = { expected: wmWant, libreoffice: has(A.text), wordcraft: has(B.text) };
    row.watermarkOk = row.watermark.libreoffice === wmWant && row.watermark.wordcraft === wmWant;
    const accentWant = await docxExpectsAccent(d.docx);
    const navy = [accentPixels(imgsA[0]), accentPixels(imgsB[0])];
    const bands = [imgsA, imgsB].map((imgs) => imgs.reduce((n, im) => n + accentBands(im), 0));
    row.accent = { expected: accentWant, libreoffice: bands[0], wordcraft: bands[1], pixels: navy };
    // Same colour on the same elements: navy on page 1 of both, and as many navy elements (name + headings) in each.
    row.accentOk = !accentWant || (navy[0] >= ACCENT_MIN_PIXELS && navy[1] >= ACCENT_MIN_PIXELS && bands[0] === bands[1]);

    const pagesOk = A.pages === B.pages;
    const textOk = row.textSim >= args.textThreshold;
    const visualOk = pagesOk && worst <= args.visualThreshold;
    const fontsSame = row.fonts[0].join() === row.fonts[1].join();
    row.textOk = textOk;
    row.visualOk = visualOk;
    row.status = textOk && visualOk ? "pass" : "fail";
    if (row.status === "fail") {
      if (row.hasTable) row.categories.push("tables");
      if (row.hasImage) row.categories.push("images");
      // With different faces, line heights and widths differ, so drift is the font's doing — unless pages changed.
      if (!fontsSame) row.categories.push("fonts");
      if (!pagesOk || (fontsSame && (layout < args.layoutThreshold || !visualOk))) row.categories.push("layout");
      if (!textOk) row.categories.push("text");
    }
    if (!row.watermarkOk) row.categories.push("watermark");
    if (!row.accentOk) row.categories.push("accent");
  }
  local?.stop();

  /* ── report ── */
  console.log(`${pad("doc", 6)}${pad("tier", 5)}${pad("via", 9)}${pad("pages", 6)}${pad("words", 6)}${pad("order", 6)}${pad("visual", 7)}${pad("layout", 7)}${pad("KB lo/wc", 10)}${pad("ms lo/wc", 11)}${pad("wm", 4)}${pad("navy el lo/wc", 14)}${pad("fonts", 6)}verdict`);
  for (const r of rows) {
    if (r.status === "cjk-guarded") { console.log(`${pad(r.id, 6)}${pad(r.tier, 5)}${pad("cjk", 9)}CJK guard -> LibreOffice, sidecar not called: ${r.guardOk ? "OK" : "GUARD FAILED"}`); continue; }
    if (r.status === "error" || r.status === "infra") { console.log(`${pad(r.id, 6)}${pad(r.tier, 5)}${pad(r.path, 9)}${r.status.toUpperCase()}: ${r.error}`); continue; }
    const same = r.fonts[0].join() === r.fonts[1].join();
    console.log(
      `${pad(r.id, 6)}${pad(r.tier, 5)}${pad(r.path, 9)}${pad(`${r.pages[0]}/${r.pages[1]}`, 6)}${pad(r.textSim.toFixed(3), 6)}${pad(r.orderSim.toFixed(3), 6)}${pad(r.visual.toFixed(3), 7)}${pad(r.layout.toFixed(2), 7)}` +
      `${pad(`${kb(r.size[0])}/${kb(r.size[1])}`, 10)}${pad(`${r.loMs}/${r.wcMs}`, 11)}${pad(r.watermarkOk ? "ok" : "BAD", 4)}${pad(r.accent.expected ? `${r.accent.libreoffice}/${r.accent.wordcraft}` : "n/a", 14)}${pad(same ? "same" : "diff", 6)}` +
      `${r.status.toUpperCase()}${r.categories.length ? " [" + r.categories.join(",") + "]" : ""}`
    );
  }
  const compared = rows.filter((r) => r.status === "pass" || r.status === "fail" || r.status === "error");
  const passed = compared.filter((r) => r.status === "pass");
  const cats = {};
  for (const r of compared) for (const c of r.categories) cats[c] = (cats[c] || 0) + 1;
  const fontPairs = {};
  for (const r of compared.filter((x) => x.fonts)) { const k = `${r.fonts[0].join("+")} -> ${r.fonts[1].join("+")}`; fontPairs[k] = (fontPairs[k] || 0) + 1; }
  const assertFails = compared.filter((r) => r.watermarkOk === false || r.accentOk === false);
  const guardFails = rows.filter((r) => r.status === "cjk-guarded" && !r.guardOk);
  const infra = rows.filter((r) => r.status === "infra");

  console.log("\nFailure taxonomy (documents per category; one document can be in several):");
  for (const c of ["tables", "images", "fonts", "layout", "text", "error", "watermark", "accent"]) {
    const note = c === "tables" || c === "images" ? "  (renderer emits none — bucket cannot fill until templates do)" : "";
    console.log(`  ${pad(c, 10)} ${cats[c] || 0}${note}`);
  }
  console.log("\nEmbedded fonts (LibreOffice -> WordCraft):");
  for (const [k, v] of Object.entries(fontPairs)) console.log(`  ${v} x ${k}`);
  const fails = compared.filter((r) => r.status !== "pass");
  if (fails.length) {
    console.log("\nFailing documents (artifacts in the out dir: resume.docx, libreoffice.pdf, wordcraft.pdf, lo-pN.png, wc-pN.png):");
    for (const r of fails) console.log(`  ${r.id}/  ${r.categories.join(", ") || "-"}${r.textDelta && (r.textDelta.onlyLibreOffice.length || r.textDelta.onlyWordCraft.length) ? `  text only-LO=${JSON.stringify(r.textDelta.onlyLibreOffice)} only-WC=${JSON.stringify(r.textDelta.onlyWordCraft)}` : ""}`);
  }
  const rate = compared.length ? (100 * passed.length) / compared.length : 0;
  console.log(`\nASSERT free-tier footer + Professional navy identical in both PDFs: ${assertFails.length ? `FAIL (${assertFails.map((r) => r.id).join(", ")})` : `OK (${compared.length - fails.filter((r) => r.status === "error").length} documents)`}`);
  console.log(`ASSERT CJK guard sends CJK documents to LibreOffice: ${guardFails.length ? "FAIL" : `OK (${rows.filter((r) => r.status === "cjk-guarded").length} documents)`}`);
  console.log(`\nVERDICT fidelity rate = ${passed.length}/${compared.length} = ${rate.toFixed(1)}% passing text AND visual checks` + (infra.length ? `; ${infra.length} INFRA errors excluded` : ""));
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ args, tools: h.tools, fidelityRate: rate, passed: passed.length, compared: compared.length, taxonomy: cats, fontPairs, rows }, null, 2));
  console.log(`report: ${path.relative(ROOT, path.join(outDir, "report.json"))}`);
  process.exit(assertFails.length || guardFails.length ? 1 : infra.length ? 2 : 0);
}

if (require.main === module) main().catch((e) => { console.error("INFRA", e && e.stack ? e.stack : e); process.exit(2); });

module.exports = { tokens, textSimilarity, wordBagSimilarity, textDelta, visualDiff, layoutSimilarity, pdfFonts, prng, makeResume, asPlainText, buildCorpus };
