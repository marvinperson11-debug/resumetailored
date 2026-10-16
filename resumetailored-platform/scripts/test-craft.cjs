#!/usr/bin/env node
/**
 * Craft sidecar + WordCraft routing (npm run test:craft; chained onto npm run test:documents).
 *
 * OFFLINE (always runs, no Docker, no network, no real binaries):
 *   1. versions.lock schema, Dockerfiles, no binaries in git, README promises.
 *   2. install-tools.cjs against a fake release served from loopback: installs + licenses; a checksum mismatch,
 *      a missing license and a plain-http URL all fail the build loudly.
 *   3. craft/server.cjs (the real server) on FAKE CLIs: secret + proof, /health versions, every endpoint, every
 *      error code (BAD_*, TOO_LARGE by header and by stream, page cap, TIMEOUT, BINARY_ERROR), per-request temp
 *      cleanup, nothing of a body / filename / CLI stderr in the logs, refuses to boot without a secret or with
 *      a binary that is not the pinned version.
 *   4. /api/craft/pdf/{preview,text} (real handlers, fake Clerk) against that real sidecar: guest 401, kill
 *      switch 503 (sidecar never called), unconfigured / unreachable / untrusted / wrong secret 503, pass-through,
 *      BAD_PDF 422, oversized 413 without calling the sidecar, sidecar timeout 503.
 *   5. exportPdf() routing with injected deps: mode off == LibreOffice only, the env parsing, pilot fallbacks
 *      (CJK, unavailable, CLI error, not a PDF, watermark, accent, a throw), paid always LibreOffice, benchmark =
 *      LibreOffice + shadow; no document text in any log line.
 *   6. CJK detection, the PNG decoder (all five filters), the benchmark harness helpers + corpus.
 * INTEGRATION (real pinned binaries): CRAFT_INTEGRATION=docker (docker compose with craft/Dockerfile) | native
 *   (craft/server.cjs on the binaries in CRAFT_TOOLS_DIR) | off | auto (default: docker if available, else
 *   native if CRAFT_TOOLS_DIR is set, else skipped with a note). /health = pinned versions, PDF->PNG, PDF->text,
 *   DOCX->PDF, xlsx round trip, CJK guard, pilot path on real output, both kill switches.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const zlib = require("zlib");
const crypto = require("crypto");
const Module = require("module");
const { spawn, spawnSync } = require("child_process");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");
const CRAFT = path.join(ROOT, "craft");

let failures = 0, passes = 0;
const check = (name, ok, detail) => {
  if (ok) { passes++; console.log("PASS ", name); }
  else { failures++; console.error("FAIL ", name, detail !== undefined ? "— " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""); }
};

// ── logs: the sidecar and the routing log through console; keep their lines, do not print them ──
const logs = [];
for (const k of ["log", "error"]) {
  const orig = console[k].bind(console);
  console[k] = (...a) => {
    const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    if (/^\[(craft|docs\/pdf)\]/.test(line)) logs.push(line);
    else orig(...a);
  };
}

// ── module hooks: fake Clerk, @/ paths, TypeScript (same approach as test-guest-gate.cjs) ──
const state = { userId: null };
const mocks = { "@clerk/nextjs/server": () => ({ auth: async () => ({ userId: state.userId }) }) };
const origLoad = Module._load;
Module._load = function (request) { return mocks[request] ? mocks[request]() : origLoad.apply(this, arguments); };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = path.join(ROOT, request.slice(2));
    for (const c of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) if (fs.existsSync(c)) return c;
  }
  return origResolve.call(this, request, parent, ...rest);
};
require.extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
const load = (rel) => require(path.join(ROOT, rel));

const { createCraftServer, loadConfig, probeVersions, proofFor } = require(path.join(CRAFT, "server.cjs"));
const { multipartFile, storedZip } = require(path.join(CRAFT, "util.cjs"));
const JSZip = require("jszip");
const LOCK = JSON.parse(fs.readFileSync(path.join(CRAFT, "versions.lock"), "utf8"));
const SECRET = "test-only-craft-secret-0123456789";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "test-craft-"));

/* ── helpers ── */
function encodePng(w, h, fill, filterFor = () => 0) {
  const stride = w * 4;
  const rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const line = Buffer.alloc(stride);
    for (let x = 0; x < w; x++) Buffer.from(fill(x, y)).copy(line, x * 4);
    const f = filterFor(y);
    const out = Buffer.alloc(stride + 1);
    out[0] = f;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4] : 0, b = prev[i], c = i >= 4 ? prev[i - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      out[i + 1] = (line[i] - pred) & 255;
    }
    rows.push(out);
    prev = line;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const NAVY = [0x1f, 0x3a, 0x5f, 255], WHITE = [255, 255, 255, 255];
const navyPng = encodePng(120, 60, (x, y) => (y >= 10 && y < 20 && x < 100) || (y >= 40 && y < 44) ? NAVY : WHITE);
const whitePng = encodePng(120, 60, () => WHITE);

async function call(base, p, { secret = SECRET, nonce, file, filename = "upload.bin", body, method = file || body !== undefined ? "POST" : "GET", headers = {} } = {}) {
  const h = { ...headers };
  if (secret !== null) h["x-craft-secret"] = secret;
  if (nonce) h["x-craft-nonce"] = nonce;
  let payload = body;
  if (file) { const fd = new FormData(); fd.append("file", new Blob([file]), filename); payload = fd; }
  const res = await fetch(base + p, { method, headers: h, body: payload });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString("utf8")); } catch { /* not json */ }
  return { status: res.status, headers: res.headers, body: buf, json };
}
/** Raw request where the body is streamed (or not sent at all) — for the size cap, which fetch cannot test. */
function rawPost(base, p, { headers = {}, chunks = [] } = {}) {
  return new Promise((resolve) => {
    const u = new URL(base + p);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "x-craft-secret": SECRET, ...headers } }, (res) => {
      const parts = [];
      res.on("data", (c) => parts.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(parts).toString() }));
      res.on("error", () => resolve({ status: res.statusCode, body: "" }));
    });
    req.on("error", (e) => resolve({ status: 0, error: e.code }));
    (async () => {
      for (const c of chunks) { if (req.destroyed) break; req.write(c); await new Promise((r) => setTimeout(r, 1)); }
      if (!req.destroyed) req.end();
    })();
  });
}
const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${server.address().port}`)));
const close = (server) => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); });
const tmpEntries = (dir) => fs.readdirSync(dir);

/*
 * ── fake CLIs (node scripts) — behaviour chosen by markers inside the uploaded file. Knobs that are not about one
 * file live in fake.json beside them: the sidecar runs every CLI with a minimal environment (by design), so
 * environment variables would never reach them. ──
 */
function writeFakes(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const common = `const fs=require("fs"),path=require("path");const a=process.argv.slice(2);const sleep=(ms)=>{const e=Date.now()+ms;while(Date.now()<e){}};
const K=JSON.parse(fs.readFileSync(path.join(__dirname,"fake.json"),"utf8"));`;
  const fakes = {
    "pdfcraft-cli": `${common}
if(a[0]==="--version"){console.log("pdfcraft-cli "+(K.pdfcraftVersion||"0.8.0"));process.exit(0);}
const s=fs.readFileSync(a[1],"latin1");
if(a[0]==="info"){if(s.includes("BADPDF")){console.error("not a readable PDF");process.exit(1);}
  const m=/PAGES=(\\d+)/.exec(s);console.log(JSON.stringify({pages:m?Number(m[1]):1,encrypted:s.includes("ENCRYPTED")}));process.exit(0);}
if(a[0]==="render"){if(s.includes("SLEEP"))sleep(10000);if(s.includes("CRASH"))process.kill(process.pid,"SIGSEGV");if(s.includes("RENDERFAIL"))process.exit(3);
  const out=a[a.indexOf("--out")+1];fs.writeFileSync(out,s.includes("NOPNG")?"junk":Buffer.from(K.png,"base64"));process.exit(0);}
if(a[0]==="text"){process.stderr.write("STDERR-SENTINEL-"+s.length);const m=/BODY=([^\\n]*)/.exec(s);process.stdout.write("TEXT:"+(m?m[1]:""));process.exit(0);}
process.exit(64);`,
    "wordcraft-cli": `${common}
if(a[0]==="--version"){console.log("wordcraft-cli 0.7.0");process.exit(0);}
const s=fs.readFileSync(a[1],"latin1");
if(a[0]==="convert"){if(s.includes("WCFAIL")){console.error("boom");process.exit(1);}if(s.includes("WCSLEEP"))sleep(10000);
  fs.writeFileSync(a[2],s.includes("WCNOTPDF")?"not a pdf":"%PDF-1.7\\n%fake wordcraft\\n");process.exit(0);}
process.exit(64);`,
    "gridcraft-cli": `${common}
if(a[0]==="version"){console.log("gridcraft-cli 0.7.0");process.exit(0);}
const s=fs.readFileSync(a[1],"latin1");
if(a[0]==="check"){const differing=[];if(s.includes("PKGDIFF")||s.includes("UNSTABLE"))differing.push("package");if(s.includes("LOSSY"))differing.push("values");
  const mism=s.includes("CALCMISMATCH")?1:0;const cats={};for(const c of differing)cats[c]={diffs:1,equal:false,examples:[]};
  console.log(JSON.stringify({files:[{opened:!s.includes("NOOPEN"),error:null,calc:{mismatched:mism},roundTrip:{differing,categories:cats}}]}));process.exit(differing.length||mism?1:0);}
if(a[0]==="convert"){fs.writeFileSync(a[2],s.replace(/PKGDIFF|LOSSY|CALCMISMATCH/g,""),"latin1");process.exit(0);}
process.exit(64);`,
  };
  const bins = { knobs: (k) => fs.writeFileSync(path.join(dir, "fake.json"), JSON.stringify(k)) };
  bins.knobs({ png: navyPng.toString("base64") });
  for (const [name, src] of Object.entries(fakes)) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, `#!${process.execPath}\n${src}\n`, { mode: 0o755 });
    bins[name] = f;
  }
  return bins;
}
const fakePdf = (markers = "", body = "") => Buffer.from(`%PDF-1.4\n${markers}\nBODY=${body}\n%%EOF\n`, "latin1");
const fakeDocx = (markers = "") => Buffer.from(`PK\x03\x04word/document.xml ${markers}`, "latin1");
const fakeXlsx = (markers = "") => Buffer.from(`PK\x03\x04xl/workbook.xml ${markers}`, "latin1");

(async () => {
  /* ═══ 1. versions.lock, Dockerfiles, hygiene ═══ */
  {
    const FIELDS = ["tool", "version", "releaseUrl", "sha256", "addedDate", "testedBy", "notes"];
    check("lock: one entry each for pdfcraft-cli, wordcraft-cli, gridcraft-cli", LOCK.map((t) => t.tool).sort().join() === "gridcraft-cli,pdfcraft-cli,wordcraft-cli", LOCK.map((t) => t.tool));
    for (const t of LOCK) {
      check(`lock[${t.tool}]: exactly the fields ${FIELDS.join("/")}`, Object.keys(t).sort().join() === [...FIELDS].sort().join(), Object.keys(t));
      check(`lock[${t.tool}]: sha256 is 64 lowercase hex`, /^[0-9a-f]{64}$/.test(t.sha256));
      check(`lock[${t.tool}]: releaseUrl is an https GitHub release pinned to v${t.version} (tag and file name)`, /^https:\/\/github\.com\/storytold\/[a-z]+\/releases\/download\//.test(t.releaseUrl) && t.releaseUrl.includes(`/v${t.version}/`) && path.basename(t.releaseUrl).includes(t.version), t.releaseUrl);
      check(`lock[${t.tool}]: addedDate is an ISO date`, /^\d{4}-\d{2}-\d{2}$/.test(t.addedDate));
    }
    check("lock: the evaluated versions (PdfCraft 0.8.0, WordCraft 0.7.0)", LOCK.find((t) => t.tool === "pdfcraft-cli").version === "0.8.0" && LOCK.find((t) => t.tool === "wordcraft-cli").version === "0.7.0");
    const df = fs.readFileSync(path.join(CRAFT, "Dockerfile"), "utf8");
    check("craft/Dockerfile: downloads + verifies via install-tools.cjs and versions.lock at build time", /COPY versions\.lock install-tools\.cjs/.test(df) && /RUN node install-tools\.cjs --lock versions\.lock/.test(df));
    check("craft/Dockerfile: runtime runs as a non-root user", /^USER node$/m.test(df));
    check("craft/Dockerfile: copies only the server sources, never a binary from the build context", /COPY server\.cjs util\.cjs \.\//.test(df) && !/COPY[^\n]*(pdfcraft|wordcraft|gridcraft)/.test(df));
    const di = fs.readFileSync(path.join(CRAFT, ".dockerignore"), "utf8");
    check("craft/.dockerignore: allow-list (fixtures and anything else stay out of the image)", /^\*$/m.test(di) && !/fixtures/.test(di));
    const appDf = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
    check("app Dockerfile: no Craft binary is added to the main image", !/pdfcraft|wordcraft|gridcraft|install-tools/i.test(appDf));
    check("app Dockerfile: LibreOffice is still installed (the default + fallback PDF path)", /libreoffice-writer/.test(appDf));
    const tracked = spawnSync("git", ["ls-files", "craft"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    const onDisk = fs.readdirSync(CRAFT, { recursive: true }).map((f) => path.join("craft", f)).filter((f) => fs.statSync(path.join(ROOT, f)).isFile());
    const suspicious = [...new Set([...tracked, ...onDisk])].filter((f) => {
      const p = path.join(ROOT, f);
      if (!fs.existsSync(p)) return false;
      const head = Buffer.alloc(4); const fd = fs.openSync(p, "r"); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
      return fs.statSync(p).size > 512 * 1024 || head.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    });
    check("git hygiene: no binary (ELF or > 512 KB) anywhere under craft/", suspicious.length === 0, suspicious);
    const readme = fs.readFileSync(path.join(CRAFT, "README.md"), "utf8");
    check("README: upgrade procedure (bump lock -> rebuild -> test:craft -> redeploy)", /versions\.lock/.test(readme) && /test-craft/.test(readme) && /redeploy/i.test(readme));
    check("README: fork rule — strip the ArtCraft branding (trademark clause)", /ArtCraft/.test(readme) && /trademark/i.test(readme) && /fork/i.test(readme));
    check("README: resume PII handling (no body logging, per-request cleanup)", /PII/.test(readme) && /no body logging|never logged/i.test(readme));
  }

  /* ═══ 2. install-tools.cjs against a fake release on loopback ═══ */
  {
    const rel = path.join(TMP, "release");
    const pkg = path.join(rel, "src", "fake-cli-1.2.3-linux-x86_64");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "fake-cli"), "#!/bin/sh\necho fake-cli 1.2.3\n");
    fs.writeFileSync(path.join(pkg, "LICENSE-MIT"), "MIT");
    const goodTar = path.join(rel, "good.tar.gz");
    spawnSync("tar", ["-czf", goodTar, "-C", path.join(rel, "src"), "fake-cli-1.2.3-linux-x86_64"]);
    fs.rmSync(path.join(pkg, "LICENSE-MIT"));
    const noLicTar = path.join(rel, "nolic.tar.gz");
    spawnSync("tar", ["-czf", noLicTar, "-C", path.join(rel, "src"), "fake-cli-1.2.3-linux-x86_64"]);
    const srv = http.createServer((req, res) => {
      const f = req.url.endsWith("nolic.tar.gz") ? noLicTar : goodTar;
      if (!req.url.startsWith("/v1.2.3/")) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": "application/gzip" });
      res.end(fs.readFileSync(f));
    });
    const base = await listen(srv);
    const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    const install = (entry, { allowHttp = true } = {}) => new Promise((resolve) => {
      const lock = path.join(TMP, `lock-${crypto.randomBytes(4).toString("hex")}.json`);
      const dest = path.join(TMP, `dest-${crypto.randomBytes(4).toString("hex")}`);
      fs.writeFileSync(lock, JSON.stringify([{ tool: "fake-cli", version: "1.2.3", addedDate: "2026-10-16", testedBy: "test", notes: "", ...entry }]));
      const p = spawn(process.execPath, [path.join(CRAFT, "install-tools.cjs"), "--lock", lock, "--dest", dest], { env: { ...process.env, TMPDIR: TMP, CRAFT_INSTALL_ALLOW_HTTP: allowHttp ? "1" : "" } });
      let out = "";
      p.stdout.on("data", (c) => (out += c));
      p.stderr.on("data", (c) => (out += c));
      p.on("close", (code) => resolve({ code, out, dest }));
    });
    const ok = await install({ releaseUrl: `${base}/v1.2.3/fake-cli-1.2.3-linux-x86_64.tar.gz`, sha256: sha(goodTar) });
    const bin = path.join(ok.dest, "bin", "fake-cli");
    check("installer: a matching checksum installs the binary (0755) and its license", ok.code === 0 && fs.existsSync(bin) && (fs.statSync(bin).mode & 0o777) === 0o755 && fs.existsSync(path.join(ok.dest, "licenses", "fake-cli", "LICENSE-MIT")), ok.out);
    check("installer: the lock is copied next to the binaries (what the sidecar reports against)", fs.existsSync(path.join(ok.dest, "versions.lock")));
    const bad = await install({ releaseUrl: `${base}/v1.2.3/fake-cli-1.2.3-linux-x86_64.tar.gz`, sha256: "0".repeat(64) });
    check("installer: a checksum mismatch FAILS the build loudly and installs nothing", bad.code === 1 && /CHECKSUM MISMATCH/.test(bad.out) && !fs.existsSync(path.join(bad.dest, "bin", "fake-cli")), bad.out);
    const nolic = await install({ releaseUrl: `${base}/v1.2.3/nolic.tar.gz`, sha256: sha(noLicTar) });
    check("installer: an archive without a LICENSE/NOTICE fails (upstream licenses must ship with the binary)", nolic.code === 1 && /license/i.test(nolic.out), nolic.out);
    const plain = await install({ releaseUrl: `${base}/v1.2.3/fake-cli-1.2.3-linux-x86_64.tar.gz`, sha256: sha(goodTar) }, { allowHttp: false });
    check("installer: a non-https release URL is refused", plain.code === 1 && /must be https/.test(plain.out), plain.out);
    const unpinned = await install({ releaseUrl: `${base}/v9.9.9/fake-cli-1.2.3-linux-x86_64.tar.gz`, sha256: sha(goodTar) });
    check("installer: a URL that is not pinned to the lock's version is refused", unpinned.code === 1 && /pinned to v1\.2\.3/.test(unpinned.out), unpinned.out);
    await close(srv);
  }

  /* ═══ 3. the sidecar on fake CLIs ═══ */
  const fakeBins = writeFakes(path.join(TMP, "fakebin"));
  const sidecarTmp = path.join(TMP, "sidecar-tmp");
  fs.mkdirSync(sidecarTmp);
  const cfgFor = (over = {}) => {
    const cfg = loadConfig({
      CRAFT_SHARED_SECRET: SECRET, CRAFT_TMP: sidecarTmp, CRAFT_HOME: path.join(TMP, "no-home"),
      PDFCRAFT_BIN: fakeBins["pdfcraft-cli"], WORDCRAFT_BIN: fakeBins["wordcraft-cli"], GRIDCRAFT_BIN: fakeBins["gridcraft-cli"], ...over,
    });
    return cfg;
  };
  const cfg = cfgFor({ CRAFT_TIMEOUT_MS: "2500" });
  cfg.versions = await probeVersions(cfg);
  let sidecarHits = 0;
  const sidecar = createCraftServer(cfg);
  sidecar.on("request", () => sidecarHits++);
  const SC = await listen(sidecar);
  {
    check("probe: --version of every fake matches the lock", JSON.stringify(cfg.versions) === JSON.stringify(Object.fromEntries(LOCK.map((t) => [t.tool, t.version]))), cfg.versions);
    fakeBins.knobs({ png: navyPng.toString("base64"), pdfcraftVersion: "0.7.9" });
    let threw = null;
    try { await probeVersions(cfgFor()); } catch (e) { threw = e.message; }
    fakeBins.knobs({ png: navyPng.toString("base64") });
    check("probe: a binary reporting another version than the lock is fatal", /reports 0\.7\.9 but versions\.lock pins 0\.8\.0/.test(threw || ""), threw);

    const h = await call(SC, "/health", { nonce: "n0nce" });
    check("health: 200 with every pinned version", h.status === 200 && h.json.ok === true && h.json.tools["pdfcraft-cli"] === "0.8.0" && h.json.tools["wordcraft-cli"] === "0.7.0" && h.json.tools["gridcraft-cli"] === "0.7.0", h.json);
    check("health: carries x-craft-proof = HMAC(secret, nonce)", h.headers.get("x-craft-proof") === proofFor(SECRET, "n0nce"));
    const noSecret = await call(SC, "/health", { secret: null, nonce: "n" });
    const wrong = await call(SC, "/pdf/text", { secret: "wrong-secret-0123456789", nonce: "n", file: fakePdf() });
    check("auth: no secret -> 401 UNAUTHORIZED, and no proof header for an unauthenticated caller", noSecret.status === 401 && noSecret.json.error === "UNAUTHORIZED" && !noSecret.headers.get("x-craft-proof"));
    check("auth: wrong secret -> 401 on a POST too (checked before the body is read)", wrong.status === 401 && !wrong.headers.get("x-craft-proof"));
    check("auth: the 401 never created a temp dir", tmpEntries(sidecarTmp).length === 0);
    check("routing: unknown path -> 404 NOT_FOUND", (await call(SC, "/nope")).status === 404);
    const notMultipart = await call(SC, "/pdf/text", { body: "raw bytes", headers: { "content-type": "application/pdf" } });
    check("request: a non-multipart body -> 400 BAD_REQUEST", notMultipart.status === 400 && notMultipart.json.error === "BAD_REQUEST");
    check("multipart: the parser finds the file part and nothing else", String(multipartFile(Buffer.from('--B\r\nContent-Disposition: form-data; name="other"\r\n\r\nx\r\n--B\r\nContent-Disposition: form-data; name="file"; filename="a"\r\n\r\nPAYLOAD\r\n--B--\r\n'), "multipart/form-data; boundary=B")) === "PAYLOAD");

    // PDF preview / text
    const one = await call(SC, "/pdf/preview", { file: fakePdf() });
    check("preview: 1 page -> image/png, x-craft-pages 1", one.status === 200 && one.headers.get("content-type") === "image/png" && one.body.equals(navyPng) && one.headers.get("x-craft-pages") === "1");
    const three = await call(SC, "/pdf/preview", { file: fakePdf("PAGES=3") });
    const z3 = three.status === 200 ? await JSZip.loadAsync(three.body) : null;
    check("preview: 3 pages -> application/zip of page-01..03.png", three.headers.get("content-type") === "application/zip" && z3 && Object.keys(z3.files).join() === "page-01.png,page-02.png,page-03.png" && (await z3.file("page-02.png").async("nodebuffer")).equals(navyPng));
    const two = await call(SC, "/pdf/preview?maxPages=2", { file: fakePdf("PAGES=3") });
    check("preview: ?maxPages=2 renders 2 of 3 (x-craft-pages 3, x-craft-rendered 2)", two.headers.get("x-craft-pages") === "3" && two.headers.get("x-craft-rendered") === "2");
    for (const q of ["maxPages=0", "maxPages=11", "maxPages=abc", "dpi=1000"]) check(`preview: ?${q} -> 400`, (await call(SC, `/pdf/preview?${q}`, { file: fakePdf() })).status === 400);
    const cap = await call(SC, "/pdf/preview", { file: fakePdf("PAGES=11") });
    check("page cap: an 11-page PDF -> 413 TOO_LARGE before anything is rendered", cap.status === 413 && cap.json.error === "TOO_LARGE" && /pages/.test(cap.json.detail));
    check("BAD_PDF: no %PDF- signature -> 422 (the CLI never runs)", (await call(SC, "/pdf/text", { file: Buffer.from("hello") })).json.error === "BAD_PDF");
    check("BAD_PDF: the CLI cannot read it -> 422", (await call(SC, "/pdf/text", { file: fakePdf("BADPDF") })).json.error === "BAD_PDF");
    check("BAD_PDF: encrypted -> 422", (await call(SC, "/pdf/text", { file: fakePdf("ENCRYPTED") })).json.detail === "encrypted");
    const text = await call(SC, "/pdf/text", { file: fakePdf("", "Avery SENTINEL-BODY-TEXT"), filename: "SENTINEL-FILENAME.pdf" });
    check("text: 200 text/plain with the extracted text", text.status === 200 && /^text\/plain/.test(text.headers.get("content-type")) && text.body.toString() === "TEXT:Avery SENTINEL-BODY-TEXT");
    const crash = await call(SC, "/pdf/preview", { file: fakePdf("CRASH") });
    check("BINARY_ERROR: a CLI killed by a signal -> 502", crash.status === 502 && crash.json.error === "BINARY_ERROR");
    check("BINARY_ERROR: a non-zero exit after validation -> 502", (await call(SC, "/pdf/preview", { file: fakePdf("RENDERFAIL") })).json.error === "BINARY_ERROR");
    check("BINARY_ERROR: output that is not a PNG -> 502", (await call(SC, "/pdf/preview", { file: fakePdf("NOPNG") })).json.error === "BINARY_ERROR");
    const t0 = Date.now();
    const slow = await call(SC, "/pdf/preview", { file: fakePdf("SLEEP") });
    check("TIMEOUT: a CLI past the request deadline is killed -> 504 TIMEOUT, promptly", slow.status === 504 && slow.json.error === "TIMEOUT" && Date.now() - t0 < 6000, [slow.status, Date.now() - t0]);

    // DOCX
    const conv = await call(SC, "/docx/convert", { file: fakeDocx() });
    check("docx: 200 application/pdf", conv.status === 200 && conv.headers.get("content-type") === "application/pdf" && conv.body.toString().startsWith("%PDF-"));
    check("docx: not a DOCX zip -> 422 BAD_DOCX", (await call(SC, "/docx/convert", { file: Buffer.from("PK\x03\x04 but no document part") })).json.error === "BAD_DOCX");
    check("docx: converter exits non-zero -> 502 BINARY_ERROR", (await call(SC, "/docx/convert", { file: fakeDocx("WCFAIL") })).json.error === "BINARY_ERROR");
    check("docx: converter writes something that is not a PDF -> 502", (await call(SC, "/docx/convert", { file: fakeDocx("WCNOTPDF") })).json.error === "BINARY_ERROR");
    check("docx: converter hangs -> 504 TIMEOUT", (await call(SC, "/docx/convert", { file: fakeDocx("WCSLEEP") })).json.error === "TIMEOUT");

    // XLSX
    const eq = await call(SC, "/xlsx/roundtrip", { file: fakeXlsx() });
    check("xlsx: identical round trip -> 200, x-craft-roundtrip: equal", eq.status === 200 && eq.headers.get("x-craft-roundtrip") === "equal" && /spreadsheetml/.test(eq.headers.get("content-type")));
    const doc = await call(SC, "/xlsx/roundtrip", { file: fakeXlsx("PKGDIFF") });
    check("xlsx: a documented diff (package) -> 200, x-craft-roundtrip: documented, x-craft-roundtrip-diffs: package:1", doc.status === 200 && doc.headers.get("x-craft-roundtrip") === "documented" && doc.headers.get("x-craft-roundtrip-diffs") === "package:1");
    const lossy = await call(SC, "/xlsx/roundtrip", { file: fakeXlsx("LOSSY") });
    check("xlsx: an undocumented diff (values) -> 422 ROUNDTRIP_LOSSY naming it", lossy.status === 422 && lossy.json.error === "ROUNDTRIP_LOSSY" && lossy.json.detail === "values");
    check("xlsx: a formula the round trip recalculates differently -> 422 ROUNDTRIP_LOSSY calc", (await call(SC, "/xlsx/roundtrip", { file: fakeXlsx("CALCMISMATCH") })).json.detail === "calc");
    check("xlsx: output that is not itself a stable round trip -> 502", (await call(SC, "/xlsx/roundtrip", { file: fakeXlsx("UNSTABLE") })).status === 502);
    check("xlsx: GridCraft would open plain text as a workbook — the sidecar refuses it (422 BAD_XLSX)", (await call(SC, "/xlsx/roundtrip", { file: Buffer.from("just,some,csv") })).json.error === "BAD_XLSX");
    check("xlsx: a workbook GridCraft cannot open -> 422 BAD_XLSX", (await call(SC, "/xlsx/roundtrip", { file: fakeXlsx("NOOPEN") })).json.error === "BAD_XLSX");

    // missing binary
    const cfgMissing = cfgFor({ WORDCRAFT_BIN: path.join(TMP, "does-not-exist") });
    cfgMissing.versions = cfg.versions;
    const sMissing = createCraftServer(cfgMissing);
    const SM = await listen(sMissing);
    check("BINARY_ERROR: the binary cannot be spawned at all -> 502", (await call(SM, "/docx/convert", { file: fakeDocx() })).json.error === "BINARY_ERROR");
    await close(sMissing);

    // size caps, against a server with a 2 KB cap
    const small = cfgFor({ CRAFT_MAX_BYTES: "2048" });
    small.versions = cfg.versions;
    const sSmall = createCraftServer(small);
    const SS = await listen(sSmall);
    const byHeader = await rawPost(SS, "/pdf/text", { headers: { "content-type": "multipart/form-data; boundary=B", "content-length": String(10 * 1024 * 1024) } });
    check("TOO_LARGE: a declared Content-Length over the cap -> 413 without reading the body", byHeader.status === 413 && /TOO_LARGE/.test(byHeader.body), byHeader);
    const big = Buffer.alloc(16 * 1024, 65);
    const byStream = await rawPost(SS, "/pdf/text", { headers: { "content-type": "multipart/form-data; boundary=B", "transfer-encoding": "chunked" }, chunks: Array.from({ length: 200 }, () => big) });
    check("TOO_LARGE: a chunked body that grows past the cap -> 413 mid-stream", byStream.status === 413 || byStream.error === "ECONNRESET" || byStream.error === "EPIPE", byStream);
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.concat([fakePdf(), Buffer.alloc(2100, 32)])]), "x.pdf");
    const filePart = await fetch(SS + "/pdf/text", { method: "POST", headers: { "x-craft-secret": SECRET }, body: fd });
    check("TOO_LARGE: a file part over the cap (body within the multipart slack) -> 413", filePart.status === 413);
    await close(sSmall);
    check("temp files: every request's directory was removed, success or failure", tmpEntries(sidecarTmp).length === 0, tmpEntries(sidecarTmp));

    const craftLines = logs.filter((l) => l.startsWith("[craft] request"));
    const joined = logs.join("\n");
    check("logging: one structured line per request", craftLines.length >= 30 && craftLines.every((l) => /"route":"\/[a-z/]*"/.test(l) && /"status":\d{3}/.test(l)), craftLines.length);
    check("logging: no body, uploaded filename or CLI stderr ever reaches the log", !/SENTINEL-BODY-TEXT|SENTINEL-FILENAME|STDERR-SENTINEL|Avery/.test(joined));
    check("logging: a failed CLI step is named in the log (step + how it failed)", /"failed":"render1:crash:SIGSEGV"/.test(joined) && /"failed":"convert:exit1"/.test(joined) && /"failed":"render1:timeout"/.test(joined));

    // boot refusal (real process)
    const boot = (env) => spawnSync(process.execPath, [path.join(CRAFT, "server.cjs")], { env: { PATH: process.env.PATH, CRAFT_HOME: path.join(TMP, "no-home"), PORT: "0", ...env }, encoding: "utf8", timeout: 10000 });
    const nosec = boot({ CRAFT_SHARED_SECRET: "" });
    check("boot: no CRAFT_SHARED_SECRET -> exits 1, 'Refusing to start'", nosec.status === 1 && /CRAFT_SHARED_SECRET.*Refusing to start/.test(nosec.stderr), nosec.stderr);
    check("boot: a secret shorter than 16 chars -> exits 1", boot({ CRAFT_SHARED_SECRET: "short" }).status === 1);
    fakeBins.knobs({ png: navyPng.toString("base64"), pdfcraftVersion: "0.9.0" });
    const wrongVer = boot({ CRAFT_SHARED_SECRET: SECRET, PDFCRAFT_BIN: fakeBins["pdfcraft-cli"], WORDCRAFT_BIN: fakeBins["wordcraft-cli"], GRIDCRAFT_BIN: fakeBins["gridcraft-cli"] });
    fakeBins.knobs({ png: navyPng.toString("base64") });
    check("boot: a binary that is not the pinned version -> exits 1 naming both versions", wrongVer.status === 1 && /reports 0\.9\.0 but versions\.lock pins 0\.8\.0/.test(wrongVer.stderr), wrongVer.stderr);
    const missingBin = boot({ CRAFT_SHARED_SECRET: SECRET });
    check("boot: a pinned binary that is missing -> exits 1", missingBin.status === 1 && /did not report a version/.test(missingBin.stderr), missingBin.stderr);
    check("zip: storedZip output opens with JSZip, bytes intact", (await (await JSZip.loadAsync(storedZip([{ name: "a.bin", data: Buffer.from([1, 2, 3]) }]))).file("a.bin").async("nodebuffer")).equals(Buffer.from([1, 2, 3])));
  }

  /* ═══ 4. app routes against the real sidecar code ═══ */
  const preview = load("app/api/craft/pdf/preview/route.ts").POST;
  const textRoute = load("app/api/craft/pdf/text/route.ts").POST;
  let ipSeq = 1;
  const appReq = (rel, body, { headers = {} } = {}) => {
    const fd = new FormData();
    if (body) fd.append("file", new Blob([body], { type: "application/pdf" }), "resume.pdf");
    return new Request(`https://app.resumetailored.com/api/craft/pdf/${rel}`, { method: "POST", headers: { "cf-connecting-ip": `198.51.100.${ipSeq++ % 250}`, ...headers }, body: fd });
  };
  const env = (o) => { for (const [k, v] of Object.entries(o)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  const json = async (res) => { try { return await res.clone().json(); } catch { return null; } };
  {
    env({ PDFCRAFT_ENABLED: undefined, CRAFT_BASE_URL: SC, CRAFT_SHARED_SECRET: SECRET });
    state.userId = null;
    let before = sidecarHits;
    const guest = await preview(appReq("preview", fakePdf()));
    check("route: a guest gets 401 and the sidecar is never called", guest.status === 401 && sidecarHits === before);
    state.userId = "user_1";
    before = sidecarHits;
    const off = await preview(appReq("preview", fakePdf()));
    check("kill switch: PDFCRAFT_ENABLED unset -> 503 craft_disabled, sidecar never called", off.status === 503 && (await json(off)).error === "craft_disabled" && sidecarHits === before);
    for (const v of ["off", "0", "false", "enabled?"]) {
      env({ PDFCRAFT_ENABLED: v });
      check(`kill switch: PDFCRAFT_ENABLED=${v} -> 503`, (await textRoute(appReq("text", fakePdf()))).status === 503);
    }
    env({ PDFCRAFT_ENABLED: "on" });
    const ok = await preview(appReq("preview", fakePdf("PAGES=2")));
    check("route: enabled -> the sidecar's zip passes through with its headers", ok.status === 200 && ok.headers.get("content-type") === "application/zip" && ok.headers.get("x-craft-pages") === "2" && ok.headers.get("cache-control") === "no-store");
    const t = await textRoute(appReq("text", fakePdf("", "hello world")));
    check("route: /api/craft/pdf/text -> 200 text", t.status === 200 && (await t.text()) === "TEXT:hello world");
    const bad = await preview(appReq("preview", fakePdf("BADPDF")));
    check("route: sidecar BAD_PDF -> 422 bad_pdf", bad.status === 422 && (await json(bad)).error === "bad_pdf");
    const cap = await preview(appReq("preview", fakePdf("PAGES=11")));
    check("route: sidecar TOO_LARGE (pages) -> 413", cap.status === 413);
    const slow = await preview(appReq("preview", fakePdf("SLEEP")));
    check("route: sidecar TIMEOUT -> 503 craft_failed (not 500)", slow.status === 503 && (await json(slow)).error === "craft_failed");
    before = sidecarHits;
    const huge = await preview(appReq("preview", Buffer.concat([fakePdf(), Buffer.alloc(10 * 1024 * 1024 + 1)])));
    check("route: a file over 10 MB -> 413 and the sidecar is never called", huge.status === 413 && sidecarHits === before);
    check("route: no file part -> 400", (await preview(appReq("preview", null))).status === 400);

    env({ CRAFT_BASE_URL: undefined });
    const unconf = await preview(appReq("preview", fakePdf()));
    check("degrade: enabled but CRAFT_BASE_URL unset -> 503 craft_unavailable", unconf.status === 503 && (await json(unconf)).error === "craft_unavailable");
    env({ CRAFT_BASE_URL: SC, CRAFT_SHARED_SECRET: "short" });
    check("degrade: a secret under 16 chars counts as unconfigured -> 503", (await preview(appReq("preview", fakePdf()))).status === 503);
    const dead = http.createServer();
    const deadUrl = await listen(dead);
    await close(dead);
    env({ CRAFT_BASE_URL: deadUrl, CRAFT_SHARED_SECRET: SECRET });
    const unreach = await preview(appReq("preview", fakePdf()));
    check("degrade: sidecar unreachable -> 503 craft_unavailable (not 500)", unreach.status === 503 && (await json(unreach)).error === "craft_unavailable");
    const rogue = http.createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(200, { "content-type": "image/png" }); res.end(navyPng); }); });
    env({ CRAFT_BASE_URL: await listen(rogue) });
    const untrusted = await preview(appReq("preview", fakePdf()));
    check("degrade: something answering without a valid x-craft-proof -> 503, its bytes are never returned", untrusted.status === 503);
    await close(rogue);
    env({ CRAFT_BASE_URL: SC, CRAFT_SHARED_SECRET: "a-different-secret-0123456789" });
    check("degrade: app and sidecar secrets differ -> the sidecar's 401 has no proof -> 503", (await preview(appReq("preview", fakePdf()))).status === 503);
    check("degrade: each reason is logged once, by name", ["unconfigured", "unreachable", "untrusted"].every((r) => logs.some((l) => l.includes(`"reason":"${r}"`))));
    env({ CRAFT_SHARED_SECRET: SECRET });
  }

  /* ═══ 5. exportPdf routing ═══ */
  const { exportPdf } = load("lib/docs/pdf.ts");
  const { wordCraftMode } = load("lib/craft/config.ts");
  const { renderDocument } = load("lib/docs/docx-render.ts");
  const { WATERMARK_TEXT } = load("lib/docs/tier.ts");
  const PII = "Quokka Sentinelperson";
  const enDoc = { name: PII, contact: ["quokka@example.com"], summary: "Analyst.", experience: [{ title: "Analyst", company: "Northwind Freight", dates: "2020 – Present", bullets: ["Did things"] }], skills: ["SQL"], education: [] };
  const zhDoc = { ...enDoc, name: "王小明", summary: "资深软件工程师。" };
  const enFree = await renderDocument({ kind: "resume", doc: enDoc }, { tier: "free", target: "pdf" });
  const enPaid = await renderDocument({ kind: "resume", doc: enDoc }, { tier: "paid", target: "pdf" });
  const zhFree = await renderDocument({ kind: "resume", doc: zhDoc }, { tier: "free", target: "pdf" });
  const letterFree = await renderDocument({ kind: "cover_letter", doc: { sender: { name: PII, contact: [] }, employer: "Northwind Freight", position: "Analyst", salutation: "Dear Hiring Manager,", paragraphs: ["Hello."], signOff: "Sincerely," } }, { tier: "free", target: "pdf" });
  const LO = Buffer.from("%PDF-1.7 libreoffice");
  const WC = Buffer.from("%PDF-1.7 wordcraft");
  const harness = (mode, script = {}) => {
    const calls = [];
    const lo = [];
    const deps = {
      mode: () => mode,
      libreoffice: async (d) => { lo.push(d); return LO; },
      craft: async (p, buf, opts) => {
        calls.push(p);
        const s = script[p];
        if (typeof s === "function") return s(buf, opts);
        if (s) return s;
        if (p === "/docx/convert") return { kind: "reached", status: 200, body: WC, headers: new Headers() };
        if (p === "/pdf/text") return { kind: "reached", status: 200, body: Buffer.from(`${PII}\n${WATERMARK_TEXT}`), headers: new Headers() };
        if (p === "/pdf/preview") return { kind: "reached", status: 200, body: navyPng, headers: new Headers() };
        throw new Error(`unexpected ${p}`);
      },
    };
    return { deps, calls, lo };
  };
  const lastFallback = () => (logs.filter((l) => l.includes("wordcraft fallback")).pop() || "");
  {
    env({ WORDCRAFT_PDF_MODE: undefined });
    check("mode: WORDCRAFT_PDF_MODE unset -> off", wordCraftMode() === "off");
    for (const [v, want] of [["off", "off"], ["benchmark", "benchmark"], [" PILOT ", "pilot"], ["pilott", "off"], ["on", "off"], ["true", "off"]]) {
      env({ WORDCRAFT_PDF_MODE: v });
      check(`mode: WORDCRAFT_PDF_MODE=${JSON.stringify(v)} -> ${want}`, wordCraftMode() === want);
    }
    env({ WORDCRAFT_PDF_MODE: undefined });

    for (const tier of ["free", "paid"]) {
      const h = harness("off");
      const out = await exportPdf(enFree, { tier }, h.deps);
      check(`off[${tier}]: LibreOffice only, on the very same buffer; the sidecar is never called`, out === LO && h.lo.length === 1 && h.lo[0] === enFree && h.calls.length === 0);
    }
    const before = logs.length;
    const pdfSrc = fs.readFileSync(path.join(ROOT, "lib/docs/pdf.ts"), "utf8");
    check("off: the default dependencies are the unchanged docxToPdf + the env switch", /const DEFAULT_DEPS: PdfDeps = \{ libreoffice: \(docx\) => docxToPdf\(docx\), craft: craftPost, mode: wordCraftMode \}/.test(pdfSrc) && /if \(mode === "off"\) return deps\.libreoffice\(docx\);/.test(pdfSrc));
    const hp = harness("pilot");
    check("pilot[paid]: LibreOffice, sidecar never called", (await exportPdf(enPaid, { tier: "paid" }, hp.deps)) === LO && hp.calls.length === 0);
    const hok = harness("pilot");
    check("pilot[free]: WordCraft's PDF when convert + watermark + accent checks pass; LibreOffice not run", (await exportPdf(enFree, { tier: "free" }, hok.deps)) === WC && hok.lo.length === 0 && hok.calls.join() === "/docx/convert,/pdf/text,/pdf/preview");
    const hlet = harness("pilot");
    check("pilot[free] cover letter (no accent styles): no accent check, WordCraft's PDF", (await exportPdf(letterFree, { tier: "free" }, hlet.deps)) === WC && hlet.calls.join() === "/docx/convert,/pdf/text");
    const cases = [
      ["CJK document", zhFree, {}, "cjk", 0],
      ["sidecar unreachable", enFree, { "/docx/convert": { kind: "unavailable", reason: "unreachable", detail: "TypeError" } }, "sidecar_unreachable", 1],
      ["sidecar timeout", enFree, { "/docx/convert": { kind: "unavailable", reason: "timeout" } }, "sidecar_timeout", 1],
      ["CLI error (502 BINARY_ERROR)", enFree, { "/docx/convert": { kind: "reached", status: 502, code: "BINARY_ERROR", body: Buffer.from("{}"), headers: new Headers() } }, "convert_failed", 1],
      ["CLI timeout (504)", enFree, { "/docx/convert": { kind: "reached", status: 504, code: "TIMEOUT", body: Buffer.from("{}"), headers: new Headers() } }, "convert_failed", 1],
      ["output not a PDF", enFree, { "/docx/convert": { kind: "reached", status: 200, body: Buffer.from("garbage"), headers: new Headers() } }, "not_pdf", 1],
      ["footer watermark missing", enFree, { "/pdf/text": { kind: "reached", status: 200, body: Buffer.from(PII), headers: new Headers() } }, "watermark_mismatch", 2],
      ["text verification unavailable", enFree, { "/pdf/text": { kind: "unavailable", reason: "unreachable" } }, "verify_unreachable", 2],
      ["navy accent missing", enFree, { "/pdf/preview": { kind: "reached", status: 200, body: whitePng, headers: new Headers() } }, "accent_missing", 3],
      ["preview is not a PNG", enFree, { "/pdf/preview": { kind: "reached", status: 200, body: Buffer.from("x"), headers: new Headers() } }, "error", 3],
      ["the client throws", enFree, { "/docx/convert": () => { throw new TypeError("kaboom"); } }, "error", 1],
    ];
    for (const [label, docx, script, reason, nCalls] of cases) {
      const h = harness("pilot", script);
      const out = await exportPdf(docx, { tier: "free" }, h.deps);
      check(`pilot[free] fallback — ${label}: LibreOffice for that document, logged reason "${reason}"`, out === LO && h.lo.length === 1 && h.calls.length === nCalls && lastFallback().includes(`"reason":"${reason}"`), [h.calls, lastFallback()]);
    }
    const hb = harness("benchmark");
    const outB = await exportPdf(enFree, { tier: "free" }, hb.deps);
    check("benchmark[free]: the user gets LibreOffice immediately", outB === LO && hb.lo.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    check("benchmark[free]: WordCraft runs in the background as shadow traffic and is logged", hb.calls[0] === "/docx/convert" && logs.some((l) => l.includes("[docs/pdf] wordcraft pdf") && l.includes('"mode":"benchmark"')));
    const hbp = harness("benchmark");
    await exportPdf(enPaid, { tier: "paid" }, hbp.deps);
    await new Promise((r) => setTimeout(r, 20));
    check("benchmark[paid]: no shadow call", hbp.calls.length === 0);
    const hbf = harness("benchmark", { "/docx/convert": () => { throw new Error("shadow boom"); } });
    check("benchmark: a failing shadow conversion never affects the user's PDF", (await exportPdf(enFree, { tier: "free" }, hbf.deps)) === LO);
    await new Promise((r) => setTimeout(r, 20));
    const routing = logs.slice(before).filter((l) => l.startsWith("[docs/pdf]"));
    check("routing logs: every line is reason/codes only — no document text", routing.length >= 10 && !routing.some((l) => /Quokka|Sentinelperson|王小明|资深/.test(l)), routing.length);
    const route = fs.readFileSync(path.join(ROOT, "app/api/documents/export/route.ts"), "utf8");
    check("export route: PDF goes through exportPdf(docx, { tier }) and nothing else", /await exportPdf\(docx, \{ tier \}\)/.test(route) && !/docxToPdf/.test(route));
  }

  /* ═══ 6. CJK detection, PNG decoder, benchmark helpers ═══ */
  const { hasCjk, docxHasCjk } = load("lib/craft/cjk.ts");
  const { decodePng, accentPixels, accentBands, docxExpectsAccent, ACCENT_MIN_PIXELS } = load("lib/craft/fidelity.ts");
  {
    for (const s of ["王小明", "東京で働く", "カタカナ", "서울", "ＡＢＣ", "。", "𠀀"]) check(`cjk: ${JSON.stringify(s)} is CJK`, hasCjk(s));
    for (const s of ["José Müller", "Zoë – Søren · résumé", "R&D “quotes”", "emoji 🙂", WATERMARK_TEXT]) check(`cjk: ${JSON.stringify(s)} is not CJK`, !hasCjk(s));
    check("cjk: an English .docx -> no", !(await docxHasCjk(enFree)));
    check("cjk: a Chinese .docx -> yes", await docxHasCjk(zhFree));
    const z = await JSZip.loadAsync(enFree);
    z.file("word/document.xml", (await z.file("word/document.xml").async("string")).replace("Did things", "&#29579;&#x5C0F;"));
    check("cjk: CJK written as XML character references -> yes", await docxHasCjk(await z.generateAsync({ type: "nodebuffer" })));
    const z2 = await JSZip.loadAsync(enFree);
    z2.file("word/footer1.xml", "<w:ftr><w:t>页脚</w:t></w:ftr>");
    check("cjk: CJK only in a footer part -> yes", await docxHasCjk(await z2.generateAsync({ type: "nodebuffer" })));
    check("cjk: an unreadable .docx -> yes (never risk WordCraft on what we cannot inspect)", await docxHasCjk(Buffer.from("not a zip")));

    const grad = (x, y) => [(x * 7 + y) & 255, (y * 13) & 255, (x * y) & 255, 255 - ((x + y) & 63)];
    const filtered = encodePng(37, 25, grad, (y) => y % 5);
    const dec = decodePng(filtered);
    let same = dec.width === 37 && dec.height === 25;
    for (let y = 0; y < 25 && same; y++) for (let x = 0; x < 37 && same; x++) { const e = grad(x, y); for (let c = 0; c < 4; c++) if (dec.data[(y * 37 + x) * 4 + c] !== e[c]) same = false; }
    check("png: decodes all five scanline filters exactly", same);
    check("png: not a PNG -> throws", (() => { try { decodePng(Buffer.from("nope")); return false; } catch { return true; } })());
    check("accent: navy block counted, white page is zero", accentPixels(decodePng(navyPng)) >= ACCENT_MIN_PIXELS && accentPixels(decodePng(whitePng)) === 0);
    check("accent: two separated navy elements = 2 bands, a white page = 0", accentBands(decodePng(navyPng)) === 2 && accentBands(decodePng(whitePng)) === 0);
    check("accent: a resume uses the accent styles; a cover letter does not", (await docxExpectsAccent(enFree)) && !(await docxExpectsAccent(letterFree)));

    const B = require(path.join(ROOT, "scripts/benchmark-wordcraft.cjs"));
    check("bench: identical text -> similarity 1", B.textSimilarity("A b C", "a  B\fc") === 1 && B.wordBagSimilarity("A b", "b a") === 1);
    check("bench: word-bag ignores order, LCS does not", B.wordBagSimilarity("x y z w", "w z y x") === 1 && B.textSimilarity("x y z w", "w z y x") < 0.5);
    check("bench: a word broken at a hyphen by a line wrap is rejoined", B.wordBagSimilarity("a 12-person team", "a 12-\nperson team") === 1);
    check("bench: textDelta names the differing words", JSON.stringify(B.textDelta("a b c", "a c d")) === JSON.stringify({ onlyLibreOffice: ["b"], onlyWordCraft: ["d"] }));
    const { pixel } = load("lib/craft/fidelity.ts");
    const imgA = decodePng(navyPng), imgW = decodePng(whitePng);
    check("bench: visualDiff of an image with itself is 0; vs blank is 1 (ink-normalised)", B.visualDiff(imgA, imgA, pixel).ratio === 0 && B.visualDiff(imgA, imgW, pixel).ratio === 1);
    check("bench: different page sizes are not comparable", B.visualDiff(imgA, decodePng(encodePng(10, 10, () => WHITE)), pixel).comparable === false);
    check("bench: layoutSimilarity of an image with itself is 1", B.layoutSimilarity(imgA, imgA, pixel) === 1);
    check("bench: pdfFonts strips subset prefixes", B.pdfFonts(Buffer.from("/BaseFont/ABCDEF+Carlito-Bold /FontName /Carlito /BaseFont/ZYXWVU+NotoSans")).join() === "Carlito,NotoSans");
    const c1 = await B.buildCorpus(10, 3, 1);
    const c2 = await B.buildCorpus(10, 3, 1);
    const xml = async (d) => (await JSZip.loadAsync(d)).file("word/document.xml").async("string");
    check("corpus: reproducible from the seed", (await Promise.all(c1.map(async (d, i) => (await xml(d.docx)) === (await xml(c2[i].docx))))).every(Boolean));
    check("corpus: both pipeline entry points, both tiers, and a CJK document", new Set(c1.map((d) => d.path)).size === 3 && c1.some((d) => d.tier === "paid") && c1.some((d) => d.tier === "free") && (await docxHasCjk(c1[c1.length - 1].docx)));
    const allXml = (await Promise.all(c1.map((d) => xml(d.docx)))).join("\n");
    const emails = allXml.match(/[\w.+-]+@[\w.-]+/g) || [];
    check("corpus: synthetic only — every email is @example.com", emails.length >= 10 && emails.every((e) => e.endsWith("@example.com")), emails.filter((e) => !e.endsWith("@example.com")));
    check("corpus: free-tier documents carry the watermark footer, paid ones do not", (await Promise.all(c1.map(async (d) => Object.keys((await JSZip.loadAsync(d.docx)).files).some((n) => /footer/.test(n)) === (d.tier === "free")))).every(Boolean));
  }
  await close(sidecar);

  /* ═══ 7. integration on the real pinned binaries ═══ */
  const mode = (process.env.CRAFT_INTEGRATION || "auto").toLowerCase();
  const hasDocker = () => spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;
  const toolsDir = process.env.CRAFT_TOOLS_DIR;
  const pick = mode === "off" ? null : mode === "docker" || (mode === "auto" && hasDocker()) ? "docker" : mode === "native" || (mode === "auto" && toolsDir) ? "native" : null;
  if (!pick) {
    console.log(`SKIP  integration on the real binaries (CRAFT_INTEGRATION=${mode}; no Docker and no CRAFT_TOOLS_DIR). Run with docker, or: node craft/install-tools.cjs --dest DIR && CRAFT_TOOLS_DIR=DIR npm run test:craft`);
  } else {
    const secret = crypto.randomBytes(24).toString("hex");
    let base = null, stop = async () => {};
    if (pick === "docker") {
      const port = process.env.CRAFT_PORT || "18080";
      const dc = (...a) => spawnSync("docker", ["compose", "-f", path.join(CRAFT, "docker-compose.yml"), "-p", "rtcraft-test", ...a], { env: { ...process.env, CRAFT_SHARED_SECRET: secret, CRAFT_PORT: port }, encoding: "utf8", timeout: 20 * 60 * 1000 });
      const up = dc("up", "-d", "--build");
      check("integration[docker]: the sidecar image builds (checksums verified) and starts", up.status === 0, (up.stderr || "").slice(-2000));
      base = `http://127.0.0.1:${port}`;
      stop = async () => { dc("down", "-v"); };
    } else {
      const home = toolsDir;
      const tmp = fs.mkdtempSync(path.join(TMP, "native-"));
      const port = 19900 + Math.floor(Math.random() * 90);
      const child = spawn(process.execPath, [path.join(CRAFT, "server.cjs")], { env: { ...process.env, CRAFT_HOME: home, CRAFT_SHARED_SECRET: secret, PORT: String(port), CRAFT_BIND: "127.0.0.1", CRAFT_TMP: tmp }, stdio: ["ignore", "ignore", "pipe"] });
      base = `http://127.0.0.1:${port}`;
      stop = async () => { child.kill(); };
    }
    let healthy = null;
    for (let i = 0; i < 600 && !healthy; i++) {
      try { const r = await fetch(`${base}/health`, { headers: { "x-craft-secret": secret } }); if (r.ok) healthy = await r.json(); } catch { /* not up yet */ }
      if (!healthy) await new Promise((r) => setTimeout(r, 250));
    }
    try {
      check(`integration[${pick}]: /health reports exactly the pinned versions`, !!healthy && LOCK.every((t) => healthy.tools[t.tool] === t.version), healthy);
      env({ CRAFT_BASE_URL: base, CRAFT_SHARED_SECRET: secret });
      const { craftPost } = load("lib/craft/client.ts");
      const fx = (f) => fs.readFileSync(path.join(CRAFT, "fixtures", f));
      const p1 = await craftPost("/pdf/preview", fx("resume.pdf"), { filename: "r.pdf", mime: "application/pdf" });
      const img = p1.kind === "reached" && p1.status === 200 ? decodePng(p1.body) : null;
      check(`integration[${pick}]: PDF -> PNG (1-page fixture, real PNG decodes, Professional navy visible)`, !!img && img.width > 500 && accentPixels(img) >= ACCENT_MIN_PIXELS, p1.kind === "reached" ? [p1.status, p1.code] : p1);
      const p2 = await craftPost("/pdf/preview", fx("resume-2p.pdf"), { filename: "r.pdf", mime: "application/pdf" });
      const z = p2.kind === "reached" && p2.status === 200 ? await JSZip.loadAsync(p2.body) : null;
      check(`integration[${pick}]: PDF -> PNG (2-page fixture -> zip of 2 decodable PNGs)`, !!z && Object.keys(z.files).length === 2 && decodePng(await z.file("page-02.png").async("nodebuffer")).height > 500);
      const tx = await craftPost("/pdf/text", fx("resume.pdf"), { filename: "r.pdf", mime: "application/pdf" });
      check(`integration[${pick}]: PDF -> text (name, a bullet and the free-tier footer)`, tx.kind === "reached" && tx.status === 200 && /Avery Fixture/.test(tx.body) && /Northwind Freight/.test(tx.body) && tx.body.toString().replace(/\s+/g, " ").includes(WATERMARK_TEXT));
      const cv = await craftPost("/docx/convert", fx("resume.docx"), { filename: "r.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const cvText = cv.kind === "reached" && cv.status === 200 ? await craftPost("/pdf/text", cv.body, { filename: "c.pdf", mime: "application/pdf" }) : null;
      check(`integration[${pick}]: DOCX -> PDF (WordCraft), and its text has the name + the footer watermark`, !!cvText && cv.body.subarray(0, 5).toString() === "%PDF-" && /Avery Fixture/.test(cvText.body) && cvText.body.toString().replace(/\s+/g, " ").includes(WATERMARK_TEXT));
      const rt = await craftPost("/xlsx/roundtrip", fx("pipeline.xlsx"), { filename: "p.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      let cells = null;
      if (rt.kind === "reached" && rt.status === 200) { const X = require("xlsx"); const wb = X.read(rt.body); const ws = wb.Sheets.Pipeline; cells = ws && [ws.A2?.v, ws.C3?.v, ws.C4?.v]; }
      check(`integration[${pick}]: xlsx round trip -> 200 with only documented diffs, and the cells survive`, !!cells && /^(equal|documented)$/.test(rt.headers.get("x-craft-roundtrip")) && (rt.headers.get("x-craft-roundtrip-diffs") || "package").split(",").every((d) => d.startsWith("package")) && JSON.stringify(cells) === JSON.stringify(["Avery Fixture", 91, 173]), [rt.kind === "reached" ? [rt.status, rt.code, rt.headers.get("x-craft-roundtrip-diffs")] : rt, cells]);
      const X = require("xlsx");
      const badCache = X.utils.book_new();
      X.utils.book_append_sheet(badCache, X.utils.aoa_to_sheet([["n"], [1], [2], [{ f: "SUM(A2:A3)", v: 3 }]]), "S"); // cached value written as TEXT "3"
      const lossy = await craftPost("/xlsx/roundtrip", X.write(badCache, { type: "buffer", bookType: "xlsx" }), { filename: "b.xlsx", mime: "application/octet-stream" });
      check(`integration[${pick}]: a workbook whose round trip would change a value (cached "3" -> 3) is refused, 422 ROUNDTRIP_LOSSY calc`, lossy.kind === "reached" && lossy.status === 422 && lossy.code === "ROUNDTRIP_LOSSY" && /calc/.test(lossy.body.toString()), lossy.kind === "reached" ? [lossy.status, lossy.body.toString()] : lossy);
      const counting = () => { const c = { n: 0, lo: 0 }; return { c, deps: (mode) => ({ mode: typeof mode === "function" ? mode : () => mode, craft: async (...a) => { c.n++; return craftPost(...a); }, libreoffice: async () => { c.lo++; return LO; } }) }; };
      const g = counting();
      check(`integration[${pick}]: CJK guard — a Chinese resume in pilot mode goes to LibreOffice; the real sidecar is never called`, (await exportPdf(zhFree, { tier: "free" }, g.deps("pilot"))) === LO && g.c.n === 0 && g.c.lo === 1);
      const p = counting();
      const pilotOut = await exportPdf(fx("resume.docx"), { tier: "free" }, p.deps("pilot"));
      check(`integration[${pick}]: pilot on real WordCraft output passes the watermark + accent guards and is served`, pilotOut !== LO && pilotOut.subarray(0, 5).toString() === "%PDF-" && p.c.lo === 0 && p.c.n === 3, [p.c, lastFallback()]);
      env({ WORDCRAFT_PDF_MODE: undefined });
      const k = counting();
      check(`integration[${pick}]: kill switch — WORDCRAFT_PDF_MODE unset: LibreOffice, the live sidecar is never called`, (await exportPdf(fx("resume.docx"), { tier: "free" }, k.deps(wordCraftMode))) === LO && k.c.n === 0);
      env({ WORDCRAFT_PDF_MODE: "pilot" });
      const k2 = counting();
      check(`integration[${pick}]: ...and WORDCRAFT_PDF_MODE=pilot flips the same call to WordCraft`, (await exportPdf(fx("resume.docx"), { tier: "free" }, k2.deps(wordCraftMode))) !== LO && k2.c.n === 3);
      env({ WORDCRAFT_PDF_MODE: undefined, PDFCRAFT_ENABLED: undefined });
      state.userId = "user_1";
      check(`integration[${pick}]: kill switch — PDFCRAFT_ENABLED unset: the route answers 503 while the sidecar is up`, (await preview(appReq("preview", fx("resume.pdf")))).status === 503);
      env({ PDFCRAFT_ENABLED: "on" });
      const live = await preview(appReq("preview", fx("resume.pdf")));
      check(`integration[${pick}]: ...and PDFCRAFT_ENABLED=on serves the real PNG through the route`, live.status === 200 && live.headers.get("content-type") === "image/png" && decodePng(Buffer.from(await live.arrayBuffer())).width > 500);
    } finally {
      await stop();
    }
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exit(1);
  console.log("ALL PASS");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
