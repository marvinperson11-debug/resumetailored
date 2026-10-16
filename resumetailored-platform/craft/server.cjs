#!/usr/bin/env node
/**
 * Craft sidecar: a minimal HTTP wrapper around the pinned PdfCraft / WordCraft / GridCraft CLIs (versions.lock).
 * It runs as its own Railway service, reachable only on the private network; the Next.js app proxies to it.
 *
 *   GET  /health          -> 200 {ok, service, tools: {<tool>: <version>}}
 *   POST /pdf/preview     multipart PDF [?maxPages=1..10&dpi=36..200] -> image/png (1 page) or application/zip
 *   POST /pdf/text        multipart PDF -> text/plain (pages separated by form feeds)
 *   POST /docx/convert    multipart DOCX -> application/pdf
 *   POST /xlsx/roundtrip  multipart XLSX -> validated .xlsx (identical round trip, or only the documented diffs)
 *
 * Every request must carry `x-craft-secret: $CRAFT_SHARED_SECRET`; a request with `x-craft-nonce` gets
 * `x-craft-proof: HMAC-SHA256(secret, nonce)` back so the app can tell it is talking to the real sidecar.
 * Hardening: body cap enforced before any temp file is written, page cap, one deadline per request, per-request
 * temp dir removed in `finally`, and NO body / filename / CLI stderr is ever logged — these are resumes.
 * Errors are JSON {error: CODE, detail?}: BAD_REQUEST, BAD_PDF, BAD_DOCX, BAD_XLSX, ROUNDTRIP_LOSSY,
 * TOO_LARGE, TIMEOUT, BINARY_ERROR, UNAUTHORIZED, NOT_FOUND, INTERNAL.
 */
const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { multipartFile, storedZip } = require("./util.cjs");

const DEFAULT_LIMITS = { maxBytes: 10 * 1024 * 1024, maxPages: 10, timeoutMs: 15_000 };
/** Multipart framing allowance on top of the file cap. */
const MULTIPART_SLACK = 64 * 1024;
/**
 * Round-trip diff categories accepted on /xlsx/roundtrip (see README "GridCraft"). `package` = OPC
 * relationships GridCraft does not re-emit, e.g. SheetJS's `sheetMetadata`; cell data is unaffected.
 */
const XLSX_DOCUMENTED_DIFFS = new Set(["package"]);
const VERSION_ARGS = { "gridcraft-cli": ["version"] };
const BIN_ENV = { "pdfcraft-cli": "PDFCRAFT_BIN", "wordcraft-cli": "WORDCRAFT_BIN", "gridcraft-cli": "GRIDCRAFT_BIN" };

class CraftError extends Error {
  constructor(status, code, detail) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const posInt = (v, d) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);

function loadConfig(env = process.env) {
  const home = env.CRAFT_HOME || "/opt/craft";
  const installedLock = path.join(home, "versions.lock");
  const lockPath = env.CRAFT_VERSIONS_LOCK || (fs.existsSync(installedLock) ? installedLock : path.join(__dirname, "versions.lock"));
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const bins = {};
  for (const t of lock) bins[t.tool] = env[BIN_ENV[t.tool]] || path.join(home, "bin", t.tool);
  return {
    secret: env.CRAFT_SHARED_SECRET || "",
    port: posInt(env.PORT, 8080),
    host: env.CRAFT_BIND || "::",
    tmpRoot: env.CRAFT_TMP || os.tmpdir(),
    lock,
    bins,
    versions: {},
    limits: {
      maxBytes: posInt(env.CRAFT_MAX_BYTES, DEFAULT_LIMITS.maxBytes),
      maxPages: posInt(env.CRAFT_MAX_PAGES, DEFAULT_LIMITS.maxPages),
      timeoutMs: posInt(env.CRAFT_TIMEOUT_MS, DEFAULT_LIMITS.timeoutMs),
    },
  };
}

/** The environment a CLI runs with: nothing of ours, caches and temp files inside the request's own dir. */
function childEnv(dir) {
  const e = { PATH: process.env.PATH || "/usr/bin:/bin", HOME: dir, TMPDIR: dir, XDG_CACHE_HOME: dir, LANG: "C.UTF-8" };
  for (const k of ["FONTCONFIG_FILE", "FONTCONFIG_PATH"]) if (process.env[k]) e[k] = process.env[k];
  return e;
}

/** Run one CLI with what is left of the request's deadline. Never rejects. */
function run(ctx, tool, args) {
  const timeout = Math.max(1, ctx.deadline - Date.now());
  return new Promise((resolve) => {
    execFile(ctx.cfg.bins[tool], args, { cwd: ctx.dir || undefined, timeout, killSignal: "SIGKILL", maxBuffer: 32 << 20, encoding: "buffer", env: childEnv(ctx.dir || ctx.cfg.tmpRoot) }, (err, stdout) => {
      if (!err) return resolve({ ok: true, stdout });
      if (err.killed && err.signal === "SIGKILL") return resolve({ ok: false, kind: "timeout", stdout });
      if (err.signal) return resolve({ ok: false, kind: "crash", signal: err.signal, stdout });
      if (typeof err.code === "number") return resolve({ ok: false, kind: "exit", exitCode: err.code, stdout });
      resolve({ ok: false, kind: "spawn", errno: String(err.code || "unknown"), stdout });
    });
  });
}

/** The error a failed CLI step becomes; the step and how it failed go to the log line (never its stderr). */
function failure(ctx, step, r) {
  ctx.log.failed = `${step}:${r.kind}${r.exitCode !== undefined ? r.exitCode : ""}${r.signal ? ":" + r.signal : ""}${r.errno ? ":" + r.errno : ""}`;
  return r.kind === "timeout" ? new CraftError(504, "TIMEOUT") : new CraftError(502, "BINARY_ERROR");
}

const isPdf = (b) => b.length > 5 && b.subarray(0, 1024).includes("%PDF-");
const isPng = (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
/** A ZIP that names `part` (OPC part names are stored uncompressed in the local/central headers). */
const isZipWith = (b, part) => b.length > 4 && b.readUInt32LE(0) === 0x04034b50 && b.includes(part);

function intParam(url, name, min, max, dflt) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new CraftError(400, "BAD_REQUEST", `${name} must be an integer ${min}..${max}`);
  return n;
}

async function writeInput(ctx, name, body) {
  const f = path.join(ctx.dir, name);
  await fsp.writeFile(f, body, { mode: 0o600 });
  return f;
}

/** Page count of an uploaded PDF; enforces the page cap. An unreadable file is the caller's fault: BAD_PDF. */
async function pdfPages(ctx, file) {
  const r = await run(ctx, "pdfcraft-cli", ["info", file]);
  if (!r.ok) {
    if (r.kind === "exit") throw new CraftError(422, "BAD_PDF");
    throw failure(ctx, "info", r);
  }
  let info;
  try { info = JSON.parse(r.stdout.toString("utf8")); } catch { throw failure(ctx, "info-json", { kind: "output" }); }
  const pages = Number(info.pages);
  if (!Number.isInteger(pages) || pages < 1) throw new CraftError(422, "BAD_PDF");
  if (info.encrypted) throw new CraftError(422, "BAD_PDF", "encrypted");
  ctx.log.pages = pages;
  if (pages > ctx.cfg.limits.maxPages) throw new CraftError(413, "TOO_LARGE", `more than ${ctx.cfg.limits.maxPages} pages`);
  return pages;
}

async function pdfInput(ctx, body) {
  if (!isPdf(body)) throw new CraftError(422, "BAD_PDF");
  const file = await writeInput(ctx, "in.pdf", body);
  return { file, pages: await pdfPages(ctx, file) };
}

/** `gridcraft-cli check --json` for one file: exit 0 = equal, exit 1 = differences (still JSON). */
async function xlsxCheck(ctx, file, step) {
  const r = await run(ctx, "gridcraft-cli", ["check", file, "--json"]);
  if (!r.ok && !(r.kind === "exit" && r.exitCode === 1)) throw failure(ctx, step, r);
  try {
    const f = JSON.parse(r.stdout.toString("utf8")).files[0];
    return { equal: r.ok, file: f };
  } catch {
    throw failure(ctx, `${step}-json`, { kind: "output" });
  }
}

const ROUTES = {
  "GET /health": async (ctx) => ({ type: "application/json", body: Buffer.from(JSON.stringify({ ok: true, service: "craft", tools: ctx.cfg.versions })) }),

  "POST /pdf/preview": async (ctx, body, url) => {
    const { file, pages } = await pdfInput(ctx, body);
    const maxPages = intParam(url, "maxPages", 1, ctx.cfg.limits.maxPages, ctx.cfg.limits.maxPages);
    const dpi = intParam(url, "dpi", 36, 200, 96);
    const n = Math.min(pages, maxPages);
    const pngs = [];
    for (let i = 1; i <= n; i++) {
      const out = path.join(ctx.dir, `page-${i}.png`);
      const r = await run(ctx, "pdfcraft-cli", ["render", file, "--page", String(i), "--dpi", String(dpi), "--out", out]);
      if (!r.ok) throw failure(ctx, `render${i}`, r);
      const png = await fsp.readFile(out).catch(() => Buffer.alloc(0));
      if (!isPng(png)) throw failure(ctx, `render${i}-output`, { kind: "output" });
      pngs.push(png);
    }
    const headers = { "x-craft-pages": String(pages), "x-craft-rendered": String(n) };
    if (n === 1) return { type: "image/png", body: pngs[0], headers };
    return { type: "application/zip", body: storedZip(pngs.map((data, i) => ({ name: `page-${String(i + 1).padStart(2, "0")}.png`, data }))), headers };
  },

  "POST /pdf/text": async (ctx, body) => {
    const { file, pages } = await pdfInput(ctx, body);
    const r = await run(ctx, "pdfcraft-cli", ["text", file]);
    if (!r.ok) throw failure(ctx, "text", r);
    return { type: "text/plain; charset=utf-8", body: r.stdout, headers: { "x-craft-pages": String(pages) } };
  },

  "POST /docx/convert": async (ctx, body) => {
    if (!isZipWith(body, "word/document.xml")) throw new CraftError(422, "BAD_DOCX");
    const file = await writeInput(ctx, "in.docx", body);
    const out = path.join(ctx.dir, "out.pdf");
    const r = await run(ctx, "wordcraft-cli", ["convert", file, out]);
    if (!r.ok) throw failure(ctx, "convert", r);
    const pdf = await fsp.readFile(out).catch(() => Buffer.alloc(0));
    if (!isPdf(pdf)) throw failure(ctx, "convert-output", { kind: "output" });
    return { type: "application/pdf", body: pdf };
  },

  "POST /xlsx/roundtrip": async (ctx, body) => {
    // GridCraft opens almost anything as a workbook (plain text included), so the signature check is ours.
    if (!isZipWith(body, "xl/workbook.xml")) throw new CraftError(422, "BAD_XLSX");
    const file = await writeInput(ctx, "in.xlsx", body);
    const before = await xlsxCheck(ctx, file, "check-in");
    if (!before.file || !before.file.opened || before.file.error) throw new CraftError(422, "BAD_XLSX");
    const rt = before.file.roundTrip || {};
    const differing = Array.isArray(rt.differing) ? rt.differing : [];
    const lossy = differing.filter((c) => !XLSX_DOCUMENTED_DIFFS.has(c));
    if (before.file.calc && before.file.calc.mismatched > 0) lossy.push("calc");
    if (lossy.length) throw new CraftError(422, "ROUNDTRIP_LOSSY", lossy.join(","));
    const out = path.join(ctx.dir, "out.xlsx");
    const r = await run(ctx, "gridcraft-cli", ["convert", file, out]);
    if (!r.ok) throw failure(ctx, "convert", r);
    const xlsx = await fsp.readFile(out).catch(() => Buffer.alloc(0));
    if (!isZipWith(xlsx, "xl/workbook.xml")) throw failure(ctx, "convert-output", { kind: "output" });
    // The output itself must be a fixed point: re-checking it may show no difference at all.
    const after = await xlsxCheck(ctx, out, "check-out");
    if (!after.equal) throw failure(ctx, "check-out", { kind: "unstable" });
    const diffs = differing.map((c) => `${c}:${(rt.categories && rt.categories[c] && rt.categories[c].diffs) || 1}`).join(",");
    return {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: xlsx,
      headers: { "x-craft-roundtrip": differing.length ? "documented" : "equal", ...(diffs ? { "x-craft-roundtrip-diffs": diffs } : {}) },
    };
  },
};

function digest(s) {
  return crypto.createHash("sha256").update(String(s)).digest();
}
function authorized(cfg, req) {
  const got = req.headers["x-craft-secret"];
  return typeof got === "string" && got.length > 0 && crypto.timingSafeEqual(digest(got), digest(cfg.secret));
}
const proofFor = (secret, nonce) => crypto.createHmac("sha256", secret).update(nonce).digest("hex");

/** The whole body, capped BEFORE anything is buffered past the cap or written to disk. */
function readBody(req, max, deadline) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > max) return reject(new CraftError(413, "TOO_LARGE"));
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => reject(new CraftError(408, "TIMEOUT", "request body")), Math.max(1, deadline - Date.now()));
    req.on("data", (c) => {
      size += c.length;
      if (size > max) {
        clearTimeout(timer);
        req.pause();
        return reject(new CraftError(413, "TOO_LARGE"));
      }
      chunks.push(c);
    });
    req.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

async function handle(cfg, req, res) {
  const t0 = Date.now();
  const url = new URL(req.url || "/", "http://craft.internal");
  const log = { method: req.method, route: url.pathname };
  let proof = null;
  let dir = null;
  let closeAfter = false;
  const send = (status, type, body, headers = {}) => {
    const h = { "content-type": type, "content-length": String(body.length), "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers };
    if (proof) h["x-craft-proof"] = proof;
    if (closeAfter) h.connection = "close";
    res.writeHead(status, h);
    res.end(body, () => { if (closeAfter) req.destroy(); });
    log.status = status;
    log.ms = Date.now() - t0;
    // One line per request. Sizes, page counts and codes only: never a body, a filename or CLI output.
    console.log("[craft] request", JSON.stringify(log));
  };
  try {
    if (!authorized(cfg, req)) { closeAfter = true; throw new CraftError(401, "UNAUTHORIZED"); }
    const nonce = req.headers["x-craft-nonce"];
    if (typeof nonce === "string" && nonce.length > 0 && nonce.length <= 128) proof = proofFor(cfg.secret, nonce);
    const handler = ROUTES[`${req.method} ${url.pathname}`];
    if (!handler) { closeAfter = req.method !== "GET"; throw new CraftError(404, "NOT_FOUND"); }
    const deadline = t0 + cfg.limits.timeoutMs;
    let file = null;
    if (req.method === "POST") {
      let raw;
      try { raw = await readBody(req, cfg.limits.maxBytes + MULTIPART_SLACK, deadline); } catch (e) { closeAfter = true; throw e; }
      file = multipartFile(raw, req.headers["content-type"]);
      if (!file || !file.length) throw new CraftError(400, "BAD_REQUEST", "a multipart file part named 'file' is required");
      if (file.length > cfg.limits.maxBytes) throw new CraftError(413, "TOO_LARGE");
      log.bytesIn = file.length;
      dir = await fsp.mkdtemp(path.join(cfg.tmpRoot, "craft-"));
    }
    const out = await handler({ cfg, dir, deadline, log }, file, url);
    log.bytesOut = out.body.length;
    send(200, out.type, out.body, out.headers);
  } catch (e) {
    const ce = e instanceof CraftError ? e : new CraftError(500, "INTERNAL");
    if (!(e instanceof CraftError)) log.internal = e && e.name ? e.name : typeof e;
    log.code = ce.code;
    send(ce.status, "application/json", Buffer.from(JSON.stringify(ce.detail ? { error: ce.code, detail: ce.detail } : { error: ce.code })));
  } finally {
    if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function createCraftServer(cfg) {
  const server = http.createServer((req, res) => {
    handle(cfg, req, res).catch(() => { try { res.destroy(); } catch { /* already gone */ } });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = cfg.limits.timeoutMs + 5_000;
  return server;
}

/** `<tool> --version` for every pinned tool; any binary that is missing or reports another version is fatal. */
async function probeVersions(cfg) {
  const ctx = { cfg, dir: null, deadline: Date.now() + 10_000, log: {} };
  const out = {};
  for (const t of cfg.lock) {
    const r = await run(ctx, t.tool, VERSION_ARGS[t.tool] || ["--version"]);
    const m = r.ok ? /(\d+\.\d+\.\d+)/.exec(r.stdout.toString("utf8")) : null;
    if (!m) throw new Error(`${t.tool} at ${cfg.bins[t.tool]} did not report a version (${r.kind || "no match"})`);
    if (m[1] !== t.version) throw new Error(`${t.tool} reports ${m[1]} but versions.lock pins ${t.version}`);
    out[t.tool] = m[1];
  }
  return out;
}

async function main() {
  const cfg = loadConfig();
  if (cfg.secret.length < 16) {
    console.error("FATAL: CRAFT_SHARED_SECRET (at least 16 characters) is required. Refusing to start.");
    process.exit(1);
  }
  try {
    cfg.versions = await probeVersions(cfg);
  } catch (e) {
    console.error(`FATAL: ${e.message}. Refusing to start.`);
    process.exit(1);
  }
  await fsp.mkdir(cfg.tmpRoot, { recursive: true });
  const server = createCraftServer(cfg);
  const listen = (host) => server.listen(cfg.port, host, () => {
    console.log(`[craft] listening on ${host}:${cfg.port}`, JSON.stringify({ tools: cfg.versions, limits: cfg.limits }));
  });
  // Railway's private network is IPv6 ("::"); a container with IPv6 disabled cannot bind it, so fall back to IPv4.
  server.once("error", (e) => {
    if (cfg.host === "::" && e.code === "EAFNOSUPPORT") listen("0.0.0.0");
    else { console.error(`FATAL: cannot listen: ${e.code || e.message}`); process.exit(1); }
  });
  listen(cfg.host);
}

if (require.main === module) main();

module.exports = { createCraftServer, loadConfig, probeVersions, proofFor, XLSX_DOCUMENTED_DIFFS, DEFAULT_LIMITS };
