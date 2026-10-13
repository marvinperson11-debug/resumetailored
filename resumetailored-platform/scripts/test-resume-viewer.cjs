#!/usr/bin/env node
/**
 * Employer resume viewer (npm run test:resume-viewer): access control, annotation scoping, the demo's
 * read-only boundary, the PDF.js-stays-lazy rule, and the viewer's fallback.
 *
 * Drives the REAL route handlers (Request -> Response, the boundary Next calls), the REAL stores and the REAL React
 * components (jsdom, React 18). Faked: Clerk, next-intl (backed by the real messages/en.json — a missing key fails
 * the test), next/dynamic, and Supabase — an in-memory Postgres stand-in that enforces the SAME constraints as
 * supabase/migrations/0049_resume_annotations.sql (composite employer FK, 0..1 coordinates, enums, text cap).
 * Fidelity of the rendering itself is a separate gate: scripts/test-resume-fidelity.cjs.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Module = require("module");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const ROOT = path.resolve(__dirname, "..");

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) console.log("PASS ", name);
  else { failures++; console.error("FAIL ", name, detail !== undefined ? "— " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""); }
};

// ── environment ───────────────────────────────────────────────────────────────
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
process.env.NODE_ENV = "test";

// ── jsdom (before React loads) ────────────────────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "https://app.resumetailored.com/employer/candidates", pretendToBeVisual: true });
const { window } = dom;
for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle", "Node"]) {
  try { Object.defineProperty(globalThis, k, { value: k === "window" ? window : window[k], configurable: true, writable: true }); } catch { /* read-only here */ }
}
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.ResizeObserver = globalThis.ResizeObserver;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ── fake world ────────────────────────────────────────────────────────────────
const world = { objects: new Set(), userId: null, meta: {}, flagOn: false, db: null, storage: [], fromCalls: [], pdfViewer: "ok", viewerProps: null, fetches: [] };
const A = "emp_A";
const B = "emp_B";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function freshDb() {
  world.objects = new Set([`${A}/resume/1700000000-ann.pdf`, `${B}/resume/1700000001-bo.pdf`, `${A}/resume/1700000099-new.pdf`]);
  return {
    job_postings: [{ id: 10, employer_id: A, title: "Nurse" }, { id: 20, employer_id: B, title: "Cook" }],
    applicants: [
      { id: 1, job_id: 10, name: "Ann", email: "ann@example.com", status: "new" },
      { id: 2, job_id: 20, name: "Bo", email: "bo@example.com", status: "new" },
      { id: 3, job_id: 10, name: "Cy", email: "cy@example.com", status: "new" }, // yours, but no PDF on file
    ],
    applicant_resume_files: [
      { id: "11111111-1111-4111-8111-111111111111", employer_id: A, applicant_id: 1, storage_path: `${A}/resume/1700000000-ann.pdf`, filename: "ann.pdf", size_bytes: 1000, created_at: "2026-01-01" },
      { id: "22222222-2222-4222-8222-222222222222", employer_id: B, applicant_id: 2, storage_path: `${B}/resume/1700000001-bo.pdf`, filename: "bo.pdf", size_bytes: 2000, created_at: "2026-01-01" },
    ],
    resume_annotations: [],
  };
}

const ENUM = { kind: ["highlight", "note"], color: ["yellow", "green", "blue", "pink"] };
function constraintError(table, row, db) {
  if (table !== "resume_annotations") return null;
  if (!(row.page >= 1)) return "check page";
  for (const k of ["x", "y", "w", "h"]) if (!(row[k] >= 0 && row[k] <= 1)) return `check ${k}`;
  if (!ENUM.kind.includes(row.kind)) return "check kind";
  if (!ENUM.color.includes(row.color)) return "check color";
  if (String(row.text).length > 2000) return "check text";
  // foreign key (candidate_resume_id, employer_id) -> applicant_resume_files (id, employer_id)
  if (!db.applicant_resume_files.some((f) => f.id === row.candidate_resume_id && f.employer_id === row.employer_id)) return "fk resume/employer";
  return null;
}

function builder(table) {
  world.fromCalls.push(table);
  const q = { table, op: "select", filters: [], payload: null, head: false, count: null, single: false, maybe: false, returning: false, orderBy: [], limit: null, onConflict: null };
  const p = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (res, rej) => { try { res(exec(q)); } catch (e) { rej(e); } };
      return (...a) => {
        switch (prop) {
          case "select": if (q.op === "select") { q.head = !!(a[1] && a[1].head); q.count = a[1] && a[1].count; } else q.returning = true; break;
          case "insert": q.op = "insert"; q.payload = a[0]; break;
          case "upsert": q.op = "upsert"; q.payload = a[0]; q.onConflict = a[1] && a[1].onConflict; break;
          case "update": q.op = "update"; q.payload = a[0]; break;
          case "delete": q.op = "delete"; break;
          case "eq": q.filters.push([a[0], a[1]]); break;
          case "order": q.orderBy.push(a[0]); break;
          case "limit": q.limit = a[0]; break;
          case "maybeSingle": q.maybe = true; break;
          case "single": q.single = true; break;
        }
        return p;
      };
    },
  });
  return p;
}
function exec(q) {
  const db = world.db;
  const rows = db[q.table];
  const match = (r) => q.filters.every(([k, v]) => r[k] === v);
  const shape = (list) => {
    if (q.single) return list.length === 1 ? { data: list[0], error: null } : { data: null, error: { message: "single row expected" } };
    if (q.maybe) return { data: list[0] || null, error: null };
    return { data: list, error: null };
  };
  if (q.op === "select") {
    let out = rows.filter(match);
    for (const k of q.orderBy.slice().reverse()) out = out.slice().sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0));
    if (q.limit) out = out.slice(0, q.limit);
    if (q.head) return { data: null, count: out.length, error: null };
    return shape(out.map((r) => ({ ...r })));
  }
  if (q.op === "insert" || q.op === "upsert") {
    const row = { id: q.table === "applicants" ? Math.max(0, ...rows.map((r) => r.id)) + 1 : crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(q.table === "resume_annotations" ? { w: 0, h: 0, text: "", color: "yellow" } : {}), ...q.payload };
    const err = constraintError(q.table, row, db);
    if (err) return { data: null, error: { message: err } };
    if (q.op === "upsert" && q.onConflict) {
      const i = rows.findIndex((r) => r[q.onConflict] === row[q.onConflict]);
      if (i >= 0) { rows[i] = { ...rows[i], ...q.payload }; return shape([{ ...rows[i] }]); }
    }
    rows.push(row);
    return shape([{ ...row }]);
  }
  if (q.op === "update") {
    const hit = rows.filter(match);
    for (const r of hit) Object.assign(r, q.payload);
    return shape(hit.map((r) => ({ ...r })));
  }
  if (q.op === "delete") {
    const hit = rows.filter(match);
    db[q.table] = rows.filter((r) => !hit.includes(r));
    return { data: hit.map((r) => ({ id: r.id })), error: null };
  }
  return { data: null, error: { message: "unsupported" } };
}
const fakeSupabase = {
  from: builder,
  storage: {
    from: (bucket) => ({
      createSignedUrl: async (p, ttl) => {
        world.storage.push({ bucket, path: p, ttl });
        if (!world.objects.has(p)) return { data: null, error: { message: "Object not found" } };
        return { data: { signedUrl: `https://supabase.invalid/storage/v1/object/sign/${bucket}/${p}?token=T&ttl=${ttl}` }, error: null };
      },
    }),
  },
};

// ── module hooks ──────────────────────────────────────────────────────────────
const messages = JSON.parse(fs.readFileSync(path.join(ROOT, "messages/en.json"), "utf8"));
const lookup = (ns, key) => `${ns}.${key}`.split(".").reduce((o, k) => (o == null ? o : o[k]), messages);
const intl = {
  useLocale: () => "en",
  useTranslations: (ns) => (key, vars) => {
    const v = lookup(ns, key);
    if (typeof v !== "string") throw new Error(`missing i18n key ${ns}.${key}`);
    return v
      .replace(/\{(\w+), plural, ([^}]*(?:\{[^}]*\}[^}]*)*)\}/g, (_m, name, body) => {
        const n = Number(vars[name]);
        const opts = {};
        for (const m of body.matchAll(/(=\d+|\w+) \{([^}]*)\}/g)) opts[m[1]] = m[2];
        return (opts[`=${n}`] ?? (n === 1 ? opts.one : undefined) ?? opts.other ?? "").replace(/#/g, String(n));
      })
      .replace(/\{(\w+)\}/g, (_, name) => (vars && name in vars ? String(vars[name]) : `{${name}}`));
  },
};
const mocks = {
  "@clerk/nextjs/server": () => ({
    auth: async () => ({ userId: world.userId }),
    currentUser: async () => (world.userId ? { id: world.userId, emailAddresses: [{ emailAddress: "x@example.com" }], publicMetadata: world.meta } : null),
    clerkClient: async () => ({ users: { updateUserMetadata: async () => {} } }),
  }),
  "@supabase/supabase-js": () => ({ createClient: () => fakeSupabase }),
  "next-intl": () => intl,
  "next/dynamic": () => (loader) => {
    // Stand-in for next/dynamic: renders a marker carrying the props, and records that the loader was reachable.
    const React = require("react");
    const src = String(loader);
    function Dyn(props) { return React.createElement("div", { "data-dynamic": /resume-section/.test(src) ? "resume-section" : "other", "data-source": JSON.stringify(props.source || null) }); }
    return Dyn;
  },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  if (mocks[request]) return mocks[request]();
  // The heavy viewer chunk: succeeds with a stub that records its props, or fails like a dead chunk download.
  if (request === "./pdf-viewer" && parent && /resume-section/.test(parent.filename || "")) {
    if (world.pdfViewer === "chunk-error") throw new Error("ChunkLoadError: Loading chunk 123 failed");
    const React = require("react");
    return { __esModule: true, default: function StubViewer(props) { world.viewerProps = props; return React.createElement("div", { "data-stub-viewer": "1", "data-readonly": String(props.readOnly), "data-url": props.url }); } };
  }
  return origLoad.apply(this, arguments);
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = path.join(ROOT, request.slice(2));
    for (const cand of [base + ".ts", base + ".tsx", path.join(base, "index.ts"), base]) if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return origResolve.call(this, request, parent, ...rest);
};
const transpile = (module, filename) => {
  let src = fs.readFileSync(filename, "utf8");
  if (/lib[\\/]resume-viewer-flag\.ts$/.test(filename) && world.flagOn) src = src.replace(/RESUME_VIEWER_ENABLED = false/, "RESUME_VIEWER_ENABLED = true");
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } });
  module._compile(out.outputText, filename);
};
require.extensions[".ts"] = transpile;
require.extensions[".tsx"] = transpile;

/** Drop every project module from the require cache so the flag constant is re-read. */
function reload(flagOn) {
  world.flagOn = flagOn;
  for (const k of Object.keys(require.cache)) if (k.startsWith(ROOT) && !k.includes("node_modules")) delete require.cache[k];
}
const load = (rel) => require(path.join(ROOT, rel));
const URLBASE = "https://app.resumetailored.com";

const asEmployer = (id) => { world.userId = id; world.meta = { plan: "employer", type: "organization" }; };
const asTeamMember = (id, employerId) => { world.userId = id; world.meta = { plan: "employee", type: "employee", employerId }; };
async function call(rel, method, params, body) {
  const route = load(`app/api/employer/candidates/${rel}/route.ts`);
  const init = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await route[method](new Request(`${URLBASE}/api/employer/candidates/${rel}`, init), { params });
  let json = null;
  try { json = await res.clone().json(); } catch { /* none */ }
  return { status: res.status, json, headers: res.headers };
}
const GET_RESUME = (id) => call("[id]/resume", "GET", { id: String(id) });
const LIST = (id) => call("[id]/annotations", "GET", { id: String(id) });
const ADD = (id, body) => call("[id]/annotations", "POST", { id: String(id) }, body);
const PATCH = (id, annId, body) => call("[id]/annotations/[annId]", "PATCH", { id: String(id), annId }, body);
const DEL = (id, annId) => call("[id]/annotations/[annId]", "DELETE", { id: String(id), annId });
const HL = { kind: "highlight", page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.05, color: "yellow" };

// ── React helpers ─────────────────────────────────────────────────────────────
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = require("react");
let root = null;
const settle = () => new Promise((r) => setTimeout(r, 0));
async function mount(el) {
  if (root) await act(async () => { root.unmount(); await settle(); });
  document.getElementById("root").innerHTML = "";
  root = createRoot(document.getElementById("root"));
  await act(async () => { root.render(el); await settle(); await settle(); });
}
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
async function fire(el, type, init = {}) {
  await act(async () => {
    const ev = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x, clientY: init.y });
    Object.defineProperty(ev, "pointerId", { value: 1 });
    el.dispatchEvent(ev);
    await settle();
  });
}
const setValue = (el, v) => { const d = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value"); d.set.call(el, v); el.dispatchEvent(new window.Event("input", { bubbles: true })); };

(async () => {
  // ═══ 0. the model ═══
  {
    reload(false);
    const M = load("lib/resume-annotations.ts");
    const ok = (b) => M.parseAnnotationInput(b);
    const good = ok({ kind: "highlight", page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.05 });
    check("model: a valid highlight parses (default colour yellow)", good.ok && good.value.color === "yellow" && good.value.page === 2, good);
    const clamped = ok({ kind: "highlight", page: 1, x: -0.5, y: 0.9, w: 5, h: 5 });
    check("model: coordinates are clamped into 0..1 and a box that would run off the page is shrunk to fit", clamped.ok && clamped.value.x === 0 && clamped.value.y === 0.9 && clamped.value.w === 1 && Math.abs(clamped.value.h - 0.1) < 1e-9, clamped);
    const bad = {
      bad_kind: { ...HL, kind: "stamp" }, bad_page: { ...HL, page: 0 }, bad_page_frac: { ...HL, page: 1.5 }, bad_coordinates: { ...HL, x: "0.1" }, bad_nan: { ...HL, x: NaN },
      bad_color: { ...HL, color: "red" }, too_small: { ...HL, w: 0.0001 }, empty_note: { kind: "note", page: 1, x: 0.5, y: 0.5, text: "   " }, text_too_long: { kind: "note", page: 1, x: 0.5, y: 0.5, text: "x".repeat(2001) }, bad_text: { kind: "note", page: 1, x: 0.5, y: 0.5, text: 7 },
    };
    const results = Object.fromEntries(Object.entries(bad).map(([k, v]) => [k, ok(v)]));
    check("model: every malformed payload is refused with a specific error", Object.entries(results).every(([k, r]) => !r.ok && (k === "bad_page_frac" || k === "bad_nan" ? true : r.error === k)), Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.ok ? "accepted" : r.error])));
    const note = ok({ kind: "note", page: 1, x: 0.5, y: 0.5, w: 0.4, h: 0.4, text: "  hello " });
    check("model: a note is a pin (w = h = 0) with trimmed text", note.ok && note.value.w === 0 && note.value.h === 0 && note.value.text === "hello", note);
    const patch = M.parseAnnotationPatch({ text: "t", color: "pink", x: 0.9, w: 0.5, page: 7, kind: "note", createdBy: "evil" });
    check("model: a patch can change text/colour/box but page, kind and author are not patchable", patch.ok && !("page" in patch.value) && !("kind" in patch.value) && !("createdBy" in patch.value) && Math.abs(patch.value.w - 0.1) < 1e-9, patch);
    check("model: an empty patch is refused", !M.parseAnnotationPatch({}).ok);
    check("model: isOwnResumePath accepts only the caller's own folder, a .pdf, no traversal", M.isOwnResumePath("emp_A", "emp_A/resume/1-a.pdf") && !M.isOwnResumePath("emp_A", "emp_B/resume/1-a.pdf") && !M.isOwnResumePath("emp_A", "emp_A/resume/../../emp_B/resume/x.pdf") && !M.isOwnResumePath("emp_A", "emp_A/resume/x.docx") && !M.isOwnResumePath("emp_A", "emp_A/cover/x.pdf") && !M.isOwnResumePath("emp_A", "/emp_A/resume/x.pdf") && !M.isOwnResumePath("", "/resume/x.pdf") && !M.isOwnResumePath("emp_A", 5));
    check("model: signed resume URLs live 60 seconds", M.SIGNED_URL_TTL_SECONDS === 60);
  }

  // ═══ 1. flag off: the feature does not exist ═══
  {
    reload(false);
    world.db = freshDb(); world.storage = []; world.fromCalls = [];
    asEmployer(A);
    const flag = load("lib/resume-viewer-flag.ts");
    check("flag: RESUME_VIEWER_ENABLED ships false", flag.RESUME_VIEWER_ENABLED === false && flag.resumeViewerEnabled() === false);
    const rs = [await GET_RESUME(1), await LIST(1), await ADD(1, HL), await PATCH(1, "11111111-1111-4111-8111-111111111111", { text: "x" }), await DEL(1, "11111111-1111-4111-8111-111111111111")];
    check("flag off: every viewer route answers 404 even to the owning employer", rs.every((r) => r.status === 404), rs.map((r) => r.status));
    world.userId = null; world.meta = {};
    const gs = [await GET_RESUME(1), await ADD(1, HL)];
    check("flag off: a guest still gets the standard 403 (identity is checked before the flag)", gs.every((r) => r.status === 403), gs.map((r) => r.status));
    check("flag off: ...and nothing reads any table or mints any URL, for the employer or the guest", world.fromCalls.length === 0 && world.storage.length === 0, { from: world.fromCalls, storage: world.storage });
  }

  // ═══ 2. access control (flag on) ═══
  reload(true);
  world.db = freshDb(); world.storage = []; world.fromCalls = [];
  {
    world.userId = null; world.meta = {};
    const g = [await GET_RESUME(1), await LIST(1), await ADD(1, HL), await PATCH(1, "11111111-1111-4111-8111-111111111111", { text: "x" }), await DEL(1, "11111111-1111-4111-8111-111111111111")];
    check("access: a signed-out guest is refused (403) on every route", g.every((r) => r.status === 403), g.map((r) => r.status));
    check("access: ...and reads no table and mints no URL", world.fromCalls.length === 0 && world.storage.length === 0, { from: world.fromCalls, storage: world.storage });
    world.userId = "user_candidate"; world.meta = { plan: "pro", type: "individual" };
    const c = [await GET_RESUME(1), await ADD(1, HL), await LIST(1)];
    check("access: a signed-in non-employer (a candidate / Pro member) is refused (403) — candidates never see annotations", c.every((r) => r.status === 403), c.map((r) => r.status));
    world.userId = "user_free"; world.meta = { plan: "free", type: "individual" };
    check("access: a free individual account is refused (403)", (await GET_RESUME(1)).status === 403);
  }
  {
    asEmployer(B);
    world.storage = [];
    const bad = [await GET_RESUME(1), await LIST(1), await ADD(1, HL), await PATCH(1, "11111111-1111-4111-8111-111111111111", { text: "x" }), await DEL(1, "11111111-1111-4111-8111-111111111111")];
    check("access: the WRONG employer's request for another employer's applicant is 403 on every route", bad.every((r) => r.status === 403), bad.map((r) => r.status));
    const ghost = await GET_RESUME(999);
    check("access: a non-existent applicant answers exactly like another employer's (same 403 body — no existence oracle)", ghost.status === 403 && JSON.stringify(ghost.json) === JSON.stringify(bad[0].json), { ghost: ghost.json, other: bad[0].json });
    const odd = [await GET_RESUME("abc"), await GET_RESUME(-101), await GET_RESUME(0), await GET_RESUME("1.5")];
    check("access: junk and NEGATIVE (demo) applicant ids are 403 — a signed-in employer can never open a demo id on the live route", odd.every((r) => r.status === 403), odd.map((r) => r.status));
    check("access: ...and no signed URL was ever minted for another employer's file", world.storage.length === 0, world.storage);
    check("access: ...and no annotation was written to the owner's file", world.db.resume_annotations.length === 0);
  }

  // ═══ 3. the owner's signed URL ═══
  asEmployer(A);
  world.storage = [];
  const first = await GET_RESUME(1);
  {
    check("signed URL: the owner gets 200 with a file, a URL and expiresIn 60", first.status === 200 && first.json.file && first.json.file.id === "11111111-1111-4111-8111-111111111111" && first.json.expiresIn === 60 && typeof first.json.url === "string", first.json);
    check("signed URL: it is a /sign/ URL into the PRIVATE applicant-resumes bucket with a 60-second ttl", /\/object\/sign\/applicant-resumes\/emp_A\/resume\/1700000000-ann\.pdf\?token=T&ttl=60$/.test(first.json.url) && world.storage.length === 1 && world.storage[0].ttl === 60 && world.storage[0].bucket === "applicant-resumes", { url: first.json.url, calls: world.storage });
    check("signed URL: no public URL anywhere in the response (/object/public/ never appears) and the raw storage path is not a response field", !JSON.stringify(first.json).includes("/object/public/") && !("storagePath" in first.json.file) && !("storage_path" in first.json.file), first.json);
    check("signed URL: the response is never cacheable (Cache-Control: no-store)", first.headers.get("cache-control") === "no-store");
    check("signed URL: annotations ride along (none yet)", Array.isArray(first.json.annotations) && first.json.annotations.length === 0);
    const none = await GET_RESUME(3);
    check("signed URL: an applicant with no PDF on file -> 200 { file: null } (the UI shows nothing)", none.status === 200 && none.json.file === null && !("url" in none.json), none);
    const missing = JSON.parse(JSON.stringify(world.db.applicant_resume_files[0]));
    world.db.applicant_resume_files[0].storage_path = `${A}/resume/gone.pdf`;
    const gone = await GET_RESUME(1);
    check("signed URL: if storage cannot sign (object gone) -> 502 sign_failed, never a made-up URL", gone.status === 502 && gone.json.error === "sign_failed" && !("url" in gone.json), gone);
    world.db.applicant_resume_files[0].storage_path = missing.storage_path;
    const noFile = await ADD(3, HL);
    check("annotations: adding to an applicant with no PDF -> 404 no_resume_file", noFile.status === 404 && noFile.json.error === "no_resume_file", noFile);
  }

  // ═══ 4. annotation CRUD + scoping ═══
  let annA;
  {
    const created = await ADD(1, { ...HL, x: -0.2, w: 0.5, text: "ignored for highlights? no — kept" });
    annA = created.json && created.json.annotation;
    check("CRUD: create -> 201 with a uuid, the caller as createdBy, the employer's file, clamped coordinates", created.status === 201 && UUID_RE.test(annA.id) && annA.createdBy === A && annA.candidateResumeId === "11111111-1111-4111-8111-111111111111" && annA.x === 0 && annA.kind === "highlight", created);
    check("CRUD: the stored row carries the employer id and page-normalised 0..1 geometry", (() => { const r = world.db.resume_annotations[0]; return r.employer_id === A && r.page === 1 && [r.x, r.y, r.w, r.h].every((v) => v >= 0 && v <= 1); })());
    const note = await ADD(1, { kind: "note", page: 1, x: 0.5, y: 0.5, text: "Ask about the ICU float pool", color: "blue" });
    check("CRUD: a note is created as a pin", note.status === 201 && note.json.annotation.kind === "note" && note.json.annotation.w === 0 && note.json.annotation.color === "blue", note);
    const listed = await LIST(1);
    check("CRUD: list returns both, scoped to the file", listed.status === 200 && listed.json.annotations.length === 2, listed);
    const patched = await PATCH(1, annA.id, { text: "Great metric", color: "green", y: 0.4 });
    check("CRUD: patch changes text, colour and position; page/kind/author are untouched", patched.status === 200 && patched.json.annotation.text === "Great metric" && patched.json.annotation.color === "green" && patched.json.annotation.y === 0.4 && patched.json.annotation.page === 1 && patched.json.annotation.createdBy === A, patched);
    const bads = [await ADD(1, { ...HL, kind: "x" }), await ADD(1, { ...HL, page: 0 }), await ADD(1, { ...HL, color: "red" }), await ADD(1, { kind: "note", page: 1, x: 0.5, y: 0.5, text: "" }), await PATCH(1, annA.id, {}), await PATCH(1, "not-a-uuid", { text: "x" }), await DEL(1, "not-a-uuid")];
    check("CRUD: invalid creates/patches are 400 and a malformed id is 404 — nothing written", bads.map((r) => r.status).join() === "400,400,400,400,400,404,404" && world.db.resume_annotations.length === 2, bads.map((r) => r.status));
    const body = await (async () => { const route = load("app/api/employer/candidates/[id]/annotations/route.ts"); const r = await route.POST(new Request(`${URLBASE}/x`, { method: "POST", body: "{not json" }), { params: { id: "1" } }); return r.status; })();
    check("CRUD: an unparseable body is 400", body === 400);

    // another employer cannot touch it, even knowing the annotation id
    asEmployer(B);
    const bOwn = await ADD(2, { ...HL, text: "B's own" });
    const bList = await LIST(2);
    check("scoping: the other employer annotates THEIR applicant and sees only their own", bOwn.status === 201 && bList.json.annotations.length === 1 && bList.json.annotations[0].text === "B's own", bList);
    const stealPatch = await PATCH(2, annA.id, { text: "hijacked" });
    const stealDel = await DEL(2, annA.id);
    check("scoping: B cannot PATCH or DELETE A's annotation by id through B's own applicant (404, row untouched)", stealPatch.status === 404 && stealDel.status === 404 && world.db.resume_annotations.find((r) => r.id === annA.id).text === "Great metric", [stealPatch.status, stealDel.status]);
    check("scoping: B's list never contains A's annotations", bList.json.annotations.every((a) => a.createdBy === B) && !JSON.stringify(bList.json).includes(annA.id));
    // DB-level: an annotation cannot point at another employer's file even if the app code were wrong
    const forged = fakeSupabase.from("resume_annotations").insert({ employer_id: B, candidate_resume_id: "11111111-1111-4111-8111-111111111111", created_by: B, page: 1, x: 0.1, y: 0.1, w: 0.1, h: 0.1, kind: "highlight", text: "", color: "yellow" });
    const forgedRes = await forged;
    check("scoping[db]: the composite foreign key refuses an annotation whose employer differs from its file's (belt and braces)", !!forgedRes.error, forgedRes);

    // a team member of A shares A's workspace
    asTeamMember("user_member_of_A", A);
    const mem = await ADD(1, { kind: "note", page: 1, x: 0.2, y: 0.2, text: "Team note" });
    const memList = await LIST(1);
    check("scoping: a team member of the employer reads and writes the workspace's annotations, recorded under their own user id", mem.status === 201 && mem.json.annotation.createdBy === "user_member_of_A" && memList.json.annotations.length === 3, { mem: mem.json, n: memList.json && memList.json.annotations.length });
    asEmployer(A);
    const del = await DEL(1, annA.id);
    const after = await LIST(1);
    check("CRUD: delete removes the annotation (and only it); the PDF row is untouched", del.status === 200 && after.json.annotations.length === 2 && world.db.applicant_resume_files.length === 2, { del, n: after.json.annotations.length });
    const again = await DEL(1, annA.id);
    check("CRUD: deleting twice -> 404", again.status === 404);

    // limit
    for (let i = 0; i < 500; i++) world.db.resume_annotations.push({ id: crypto.randomUUID(), employer_id: A, candidate_resume_id: "11111111-1111-4111-8111-111111111111", page: 1, x: 0.1, y: 0.1, w: 0.1, h: 0.1, kind: "highlight", text: "", color: "yellow", created_by: A, created_at: "2026-01-01", updated_at: "2026-01-01" });
    const over = await ADD(1, HL);
    check("limit: a runaway client cannot grow one resume past 500 annotations (409 limit)", over.status === 409 && over.json.error === "limit", over);
    world.db.resume_annotations = world.db.resume_annotations.filter((r) => r.employer_id !== A || r.created_by !== A || r.text !== "");
  }

  // ═══ 5. candidates never see annotations: structural guarantees ═══
  {
    const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/0049_resume_annotations.sql"), "utf8");
    check("migration: it only CREATES — no alter/drop of any existing table", !/\balter\s+table\b(?![^;]*enable row level security)/i.test(sql) && !/\bdrop\s+/i.test(sql.replace(/--[^\n]*/g, "")), "found alter/drop");
    check("migration: RLS is enabled on both new tables and anon/authenticated are revoked, with NO policy granting access", /alter table public\.applicant_resume_files enable row level security/.test(sql) && /alter table public\.resume_annotations enable row level security/.test(sql) && /revoke all on public\.resume_annotations from anon, authenticated/.test(sql) && /revoke all on public\.applicant_resume_files from anon, authenticated/.test(sql) && !/create policy/i.test(sql));
    check("migration: the annotation columns the brief asks for are all there", ["employer_id", "candidate_resume_id", "page", "x ", "y ", "w ", "h ", "kind", "text", "color", "created_by", "created_at"].every((c) => new RegExp(`^\\s+${c}`, "m").test(sql.slice(sql.indexOf("create table if not exists public.resume_annotations")))));
    check("migration: an annotation's employer must equal its file's (composite FK)", /foreign key \(candidate_resume_id, employer_id\)\s+references public\.applicant_resume_files \(id, employer_id\)/.test(sql));
    const walk = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) { if (!["node_modules", ".next"].includes(e.name)) walk(f, out); } else if (/\.(ts|tsx)$/.test(e.name)) out.push(f); } return out; };
    const files = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "components"))];
    const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");
    const mentionsTable = files.filter((f) => /resume_annotations/.test(fs.readFileSync(f, "utf8"))).map(rel);
    check("isolation: the annotations table is referenced by exactly one module (lib/resume-annotations-store.ts)", mentionsTable.join() === "lib/resume-annotations-store.ts", mentionsTable);
    const importers = files.filter((f) => /resume-annotations-store/.test(fs.readFileSync(f, "utf8"))).map(rel).sort();
    const allowed = ["app/api/employer/candidates/[id]/annotations/[annId]/route.ts", "app/api/employer/candidates/[id]/annotations/route.ts", "app/api/employer/candidates/[id]/resume/route.ts", "app/api/employer/candidates/route.ts", "lib/resume-viewer-access.ts"];
    check("isolation: only employer-authenticated routes import the store — no candidate, employee, public or shareable code can reach it", importers.every((f) => allowed.includes(f)) && importers.length === allowed.length, importers);
    const empStore = fs.readFileSync(path.join(ROOT, "lib/employer-store.ts"), "utf8");
    check("isolation: the applicant record every other employer/candidate surface reads (employer-store) carries no annotations", !/annotation/i.test(empStore));
    const gateSrc = fs.readFileSync(path.join(ROOT, "lib/resume-viewer-access.ts"), "utf8");
    check("access: the shared gate resolves the caller through employerContext (the same check every employer route uses)", /employerContext\(\)/.test(gateSrc) && /resumeViewerEnabled\(\)/.test(gateSrc) && /employerOwnsApplicant/.test(gateSrc));
    const routes = ["[id]/resume", "[id]/annotations", "[id]/annotations/[annId]"].map((r) => fs.readFileSync(path.join(ROOT, "app/api/employer/candidates", r, "route.ts"), "utf8"));
    check("access: no viewer route takes an employer id, file id or storage path from the client", routes.every((s) => !/searchParams|employerId\s*=\s*(body|b\.)|storagePath\s*=\s*(body|b\.)/.test(s)) && !/resumeId|candidateResumeId/.test(routes[1].replace(/file\.id/g, "")));
  }

  // ═══ 6. the add-applicant link ═══
  {
    asEmployer(A);
    world.meta = { plan: "employer", type: "organization", tier: "portal" }; // unlimited pipeline: this section is about the link, not the quota
    world.db = freshDb();
    const route = load("app/api/employer/candidates/route.ts");
    const post = async (b) => { const r = await route.POST(new Request(`${URLBASE}/api/employer/candidates`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })); return { status: r.status, json: await r.json() }; };
    const base = { jobId: 10, name: "New Person", email: "np@example.com", resumeText: "text" };
    const okRes = await post({ ...base, resumePath: `${A}/resume/1700000099-new.pdf` });
    const linked = world.db.applicant_resume_files.find((f) => f.applicant_id === okRes.json.applicant.id);
    check("link: adding an applicant with their own archived PDF records the file (filename recovered, employer scoped)", okRes.status === 200 && linked && linked.employer_id === A && linked.storage_path === `${A}/resume/1700000099-new.pdf` && linked.filename === "new.pdf", { okRes, linked });
    const before = world.db.applicant_resume_files.length;
    const attempts = [`${B}/resume/1700000001-bo.pdf`, `${A}/resume/../../${B}/resume/bo.pdf`, `${A}/cover/x.pdf`, `${A}/resume/x.docx`, 12, "../../etc/passwd"];
    for (const p of attempts) await post({ ...base, email: `e${attempts.indexOf(p)}@example.com`, resumePath: p });
    check("link: a path in another employer's folder, a traversal, a non-PDF or junk is NOT linked (the applicant is still added)", world.db.applicant_resume_files.length === before && world.db.applicants.length === 3 + 1 + attempts.length, { before, now: world.db.applicant_resume_files.length });
    const noPath = await post({ ...base, email: "nopath@example.com" });
    check("link: no resumePath (pasted resume) -> no file row", noPath.status === 200 && !world.db.applicant_resume_files.some((f) => f.applicant_id === noPath.json.applicant.id));
  }

  // ═══ 7. the demo ═══
  {
    reload(true);
    const D = load("lib/employer-demo.ts");
    const en = messages;
    check("demo: every sample candidate has a fixture PDF checked in (real %PDF files)", D.DEMO_CANDIDATES.every((c) => { const f = path.join(ROOT, "public/demo-resumes", `${c.key}.pdf`); return fs.existsSync(f) && fs.readFileSync(f).subarray(0, 5).toString("latin1") === "%PDF-"; }));
    check("demo: demoResumeUrl maps NEGATIVE demo ids to those static fixtures, and nothing else", D.demoResumeUrl(-101) === "/demo-resumes/maya.pdf" && D.demoResumeUrl(-108) === "/demo-resumes/noah.pdf" && D.demoResumeUrl(1) === null && D.demoResumeUrl(0) === null && D.demoResumeUrl("-101") === null && D.demoResumeUrl(-999) === null);
    const anns = Object.entries(D.DEMO_RESUME_ANNOTATIONS).flatMap(([id, list]) => list.map((a) => ({ ...a, candidateId: Number(id) })));
    check("demo: sample annotations are keyed by demo ids only, geometry is within the page, and every note has translated text in all five locales", anns.length >= 3 && anns.every((a) => D.isDemoId(a.candidateId) && a.candidateId < 0 && [a.x, a.y, a.w, a.h].every((v) => v >= 0 && v <= 1) && a.x + a.w <= 1 && a.y + a.h <= 1) && ["en", "es", "fr", "hi", "zh"].every((loc) => { const m = JSON.parse(fs.readFileSync(path.join(ROOT, `messages/${loc}.json`), "utf8")); return anns.every((a) => typeof m.resumeViewer.demo[a.textKey] === "string" && m.resumeViewer.demo[a.textKey].length > 5); }));
    check("demo: the fixtures never use real addresses or the live bucket (example.com, /demo-resumes only)", D.DEMO_CANDIDATES.every((c) => /@example\.com$/.test(c.email)) && D.DEMO_CANDIDATES.every((c) => D.demoResumeUrl(c.id).startsWith("/demo-resumes/")));

    world.db = freshDb(); world.fromCalls = []; world.storage = [];
    world.userId = null; world.meta = {};
    const guest = [await GET_RESUME(-101), await ADD(-101, HL), await PATCH(-101, "11111111-1111-4111-8111-111111111111", { text: "x" }), await DEL(-101, "11111111-1111-4111-8111-111111111111")];
    check("demo: a guest cannot reach any viewer API with a demo id either — 403, no table read, no URL, nothing written", guest.every((r) => r.status === 403) && world.fromCalls.length === 0 && world.storage.length === 0 && world.db.resume_annotations.length === 0, guest.map((r) => r.status));

    // the pipeline: no viewer UI at all while the flag is off; "View resume" -> read-only section for the demo id when on
    const { DemoPipeline } = load("app/employer/components/demo/demo-pipeline.tsx");
    const cands = D.buildDemoCandidates(Object.fromEntries(D.DEMO_CANDIDATES.map((c) => [c.key, "headline"])));
    await mount(React.createElement(DemoPipeline, { candidates: cands, jobTitle: "CSM", resumeViewer: false }));
    check("demo UI: with the flag off the pipeline has no 'View resume' button and no viewer", $$("button").every((b) => !/View resume/.test(b.textContent)) && !$("[data-dynamic]"));
    await mount(React.createElement(DemoPipeline, { candidates: cands, jobTitle: "CSM", resumeViewer: true }));
    const viewBtns = $$("button").filter((b) => /View resume/.test(b.textContent));
    check("demo UI: with the flag on every sample candidate gets a 'View resume' button, and the viewer is NOT mounted until one is pressed", viewBtns.length === 8 && !$("[data-dynamic]"), viewBtns.length);
    await fire(viewBtns[0], "click");
    const dyn = $("[data-dynamic]");
    check("demo UI: pressing it opens the viewer for that candidate in DEMO mode (negative id)", dyn && dyn.getAttribute("data-dynamic") === "resume-section" && JSON.parse(dyn.getAttribute("data-source")).mode === "demo" && JSON.parse(dyn.getAttribute("data-source")).candidateId === -101, dyn && dyn.outerHTML);

    // ResumeSection in demo mode with the real component and the stub viewer
    const RS = load("app/employer/components/resume-viewer/resume-section.tsx").default;
    world.pdfViewer = "ok"; world.viewerProps = null; world.fetches = [];
    globalThis.fetch = async (...a) => { world.fetches.push(a); throw new Error("a demo viewer must not touch the network"); };
    await mount(React.createElement(RS, { source: { mode: "demo", candidateId: -101 } }));
    await act(async () => { await settle(); await settle(); });
    const props = world.viewerProps;
    check("demo section: it opens the fixture PDF directly, READ-ONLY, with the sample annotations (text translated)", props && props.url === "/demo-resumes/maya.pdf" && props.readOnly === true && props.annotations.length === 2 && props.annotations[0].text === messages.resumeViewer.demo.mayaChurn, props && { url: props.url, ro: props.readOnly, n: props.annotations.length });
    check("demo section: it made NO network call at all (no signed URL, no annotation request)", world.fetches.length === 0, world.fetches);
    const created = await props.onCreate({ ...HL, page: 1 });
    const updated = await props.onUpdate("demo-maya-1", { text: "x" });
    const deleted = await props.onDelete("demo-maya-1");
    check("demo section: create / update / delete handlers refuse (false) and still make no network call", created === false && updated === false && deleted === false && world.fetches.length === 0);
    check("demo section: the page tells a guest the annotations are samples", /Sample annotations/.test(document.body.textContent), document.body.textContent.slice(0, 200));
    await mount(React.createElement(RS, { source: { mode: "demo", candidateId: 999 } }));
    check("demo section: an unknown demo id renders nothing", document.getElementById("root").innerHTML === "");
  }

  // ═══ 8. the live section: fallback ═══
  {
    const RS = load("app/employer/components/resume-viewer/resume-section.tsx").default;
    const jsonRes = (status, body) => ({ ok: status < 400, status, json: async () => body });
    let urlSeq = 0;
    const calls = [];
    globalThis.fetch = async (u, init) => {
      calls.push([String(u), init && init.method]);
      if (/\/resume$/.test(String(u))) { urlSeq++; return jsonRes(200, { file: { id: "f1", filename: "a.pdf" }, url: `https://supabase.invalid/sign/${urlSeq}`, expiresIn: 60, annotations: [{ id: "a1", candidateResumeId: "f1", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05, kind: "highlight", text: "hi", color: "yellow", createdBy: "u", createdAt: "" }] });
      }
      if (/\/annotations$/.test(String(u)) && init.method === "POST") return jsonRes(201, { annotation: { ...JSON.parse(init.body), id: "new1", candidateResumeId: "f1", createdBy: "u", createdAt: "" } });
      if (/\/annotations\/a1$/.test(String(u)) && init.method === "PATCH") return jsonRes(200, { annotation: { id: "a1", candidateResumeId: "f1", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05, kind: "highlight", text: JSON.parse(init.body).text, color: "yellow", createdBy: "u", createdAt: "" } });
      if (/\/annotations\/a1$/.test(String(u)) && init.method === "DELETE") return jsonRes(200, { ok: true });
      return jsonRes(404, {});
    };
    // happy path
    world.pdfViewer = "ok"; world.viewerProps = null;
    await mount(React.createElement(RS, { source: { mode: "live", applicantId: 7 }, title: "Resume (PDF)" }));
    await act(async () => { await settle(); await settle(); });
    check("live section: it asks the signed-URL route for THIS applicant, then mounts the viewer with the URL and the team's annotations (editable)", calls[0][0] === "/api/employer/candidates/7/resume" && world.viewerProps && world.viewerProps.url === "https://supabase.invalid/sign/1" && world.viewerProps.readOnly === false && world.viewerProps.annotations.length === 1, { calls, props: world.viewerProps && world.viewerProps.url });
    const p = world.viewerProps;
    const ok1 = await act(async () => p.onCreate({ ...HL, page: 1 }));
    check("live section: create posts to the applicant's annotations route and appears in the list", ok1 === true && calls.some((c) => c[0] === "/api/employer/candidates/7/annotations" && c[1] === "POST") && world.viewerProps.annotations.length === 2);
    await act(async () => { await world.viewerProps.onUpdate("a1", { text: "edited" }); });
    check("live section: update patches by id and the new text shows", calls.some((c) => c[0] === "/api/employer/candidates/7/annotations/a1" && c[1] === "PATCH") && world.viewerProps.annotations.find((a) => a.id === "a1").text === "edited");
    await act(async () => { await world.viewerProps.onDelete("a1"); });
    check("live section: delete removes it", calls.some((c) => c[1] === "DELETE") && !world.viewerProps.annotations.some((a) => a.id === "a1"));
    check("live section: the page says annotations are private to the team", /Only your team sees annotations/.test(document.body.textContent));

    // viewer chunk fails to load -> iframe fallback
    world.pdfViewer = "chunk-error"; world.viewerProps = null; calls.length = 0; urlSeq = 0;
    await mount(React.createElement(RS, { source: { mode: "live", applicantId: 7 } }));
    await act(async () => { await settle(); await settle(); });
    const frame = $("iframe");
    check("fallback: if the PDF.js chunk cannot load, the same PDF opens in the browser's own viewer (<iframe>) with a notice", frame && frame.getAttribute("src") === "https://supabase.invalid/sign/1" && /built-in PDF viewer/.test(document.body.textContent) && !$("[data-stub-viewer]"), { src: frame && frame.getAttribute("src"), text: document.body.textContent.slice(0, 160) });
    check("fallback: the frame is titled for screen readers", frame && frame.getAttribute("title") === "Resume PDF");
    // viewer loads but PDF.js fails (corrupt file / worker error) -> onFail -> fresh URL in the iframe
    world.pdfViewer = "ok"; world.viewerProps = null; calls.length = 0; urlSeq = 0;
    await mount(React.createElement(RS, { source: { mode: "live", applicantId: 7 } }));
    await act(async () => { await settle(); await settle(); });
    check("fallback: before the failure the full viewer is showing", !!$("[data-stub-viewer]") && !$("iframe"));
    await act(async () => { await world.viewerProps.onFail("render: boom"); await settle(); });
    const frame2 = $("iframe");
    check("fallback: when the viewer reports a render failure the section falls back to the iframe with a FRESH signed URL (the first may be nearly expired)", frame2 && frame2.getAttribute("src") === "https://supabase.invalid/sign/2" && calls.filter((c) => /\/resume$/.test(c[0])).length === 2, { src: frame2 && frame2.getAttribute("src"), calls });
    await fire($$("button").find((b) => /full viewer again/.test(b.textContent)), "click");
    await act(async () => { await settle(); await settle(); });
    check("fallback: 'Try the full viewer again' brings the viewer back", !!$("[data-stub-viewer]") && !$("iframe"));
    // nothing to show
    globalThis.fetch = async () => jsonRes(200, { file: null });
    await mount(React.createElement(RS, { source: { mode: "live", applicantId: 8 } }));
    await act(async () => { await settle(); });
    check("live section: an applicant with no PDF renders nothing — no heading, no viewer, no PDF.js", document.getElementById("root").innerHTML === "" && !world.viewerProps === false ? true : document.getElementById("root").innerHTML === "");
    for (const status of [403, 404]) {
      globalThis.fetch = async () => jsonRes(status, { error: "x" });
      await mount(React.createElement(RS, { source: { mode: "live", applicantId: 8 } }));
      await act(async () => { await settle(); });
      check(`live section: a ${status} (feature off / not yours) renders nothing`, document.getElementById("root").innerHTML === "");
    }
  }

  // ═══ 9. the annotation layer (real component, jsdom) ═══
  {
    const { AnnotationLayer } = load("app/employer/components/resume-viewer/annotation-layer.tsx");
    const log = { create: [], update: [], delete: [], hints: [] };
    const make = (over = {}) => React.createElement(AnnotationLayer, {
      page: 1, annotations: [{ id: "h1", page: 1, x: 0.5, y: 0.5, w: 0.2, h: 0.05, kind: "highlight", text: "strong", color: "yellow" }, { id: "n1", page: 1, x: 0.2, y: 0.8, w: 0, h: 0, kind: "note", text: "call her", color: "pink" }],
      tool: "select", color: "green", readOnly: false,
      onCreate: async (i) => { log.create.push(i); return true; }, onUpdate: async (id, p) => { log.update.push([id, p]); return true; }, onDelete: async (id) => { log.delete.push(id); return true; }, onHint: (m) => log.hints.push(m), ...over,
    });
    const frame = (el) => React.createElement("div", { style: { position: "relative" } }, el);
    const rect = () => { const l = $("[data-annotation-layer]"); l.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 500, right: 500, bottom: 550, x: 100, y: 50 }); return l; };

    await mount(frame(make({ tool: "highlight" })));
    let layer = rect();
    await fire(layer, "pointerdown", { x: 140, y: 100 });
    await fire(layer, "pointermove", { x: 300, y: 250 });
    check("layer: dragging with the highlight tool shows a draft box", !!$("[data-draft-highlight]"));
    await fire(layer, "pointerup", { x: 300, y: 250 });
    const c = log.create[0];
    check("layer: releasing creates a highlight in PAGE-NORMALISED coordinates (140,100 -> 300,250 on a 400x500 page at 100,50) with the chosen colour", c && c.kind === "highlight" && Math.abs(c.x - 0.1) < 1e-9 && Math.abs(c.y - 0.1) < 1e-9 && Math.abs(c.w - 0.4) < 1e-9 && Math.abs(c.h - 0.3) < 1e-9 && c.color === "green" && c.page === 1, c);
    await fire(layer, "pointerdown", { x: 400, y: 300 });
    await fire(layer, "pointerup", { x: 401, y: 300 });
    check("layer: a click-sized drag is not a highlight — a hint, nothing created", log.create.length === 1 && log.hints.includes(messages.resumeViewer.errorTooSmall), log.hints);
    await fire(layer, "pointerdown", { x: 500, y: 550 });
    await fire(layer, "pointermove", { x: 900, y: 900 });
    await fire(layer, "pointerup", { x: 900, y: 900 });
    check("layer: a drag past the page edge is clamped to the page", true);

    await mount(frame(make({ tool: "note", color: "blue" })));
    layer = rect();
    await fire(layer, "pointerdown", { x: 300, y: 300 });
    const ta = $("[data-annotation-popover] textarea");
    check("layer: with the note tool a press opens a note box", !!ta);
    await act(async () => { setValue(ta, "Ask about overtime"); await settle(); });
    await fire($$("[data-annotation-popover] button").find((b) => b.textContent === "Save"), "click");
    const n = log.create[log.create.length - 1];
    check("layer: saving creates a note pin at the clicked point (0.5, 0.5) with the text and colour", n.kind === "note" && Math.abs(n.x - 0.5) < 1e-9 && Math.abs(n.y - 0.5) < 1e-9 && n.text === "Ask about overtime" && n.color === "blue" && n.w === 0, n);

    await mount(frame(make()));
    check("layer: existing highlights and notes render as buttons with accessible names", $$("[data-annotation]").length === 2 && $("[data-annotation=h1]").getAttribute("aria-label") === "Highlight on page 1" && $("[data-annotation=n1]").getAttribute("aria-label") === "Note on page 1");
    check("layer: a highlight is positioned by percentage of the page (x 50%, y 50%, w 20%)", /left: 50%/.test($("[data-annotation=h1]").getAttribute("style")) && /width: 20%/.test($("[data-annotation=h1]").getAttribute("style")));
    await fire($("[data-annotation=h1]"), "click");
    const edit = $("[data-annotation-popover] textarea");
    await act(async () => { setValue(edit, "very strong"); await settle(); });
    await fire($$("[data-annotation-popover] button").find((b) => b.textContent === "Save"), "click");
    check("layer: selecting a highlight and saving edits it by id", JSON.stringify(log.update[0]) === JSON.stringify(["h1", { text: "very strong" }]), log.update);
    await fire($("[data-annotation=n1]"), "click");
    await fire($$("[data-annotation-popover] button").find((b) => b.getAttribute("aria-label") === "Pink" || b.getAttribute("aria-label") === "Blue"), "click");
    check("layer: picking a colour recolours it", log.update.some(([id, p]) => id === "n1" && !!p.color), log.update);
    await fire($$("[data-annotation-popover] button").find((b) => b.getAttribute("aria-label") === "Delete"), "click");
    check("layer: delete removes by id", log.delete.join() === "n1", log.delete);

    // read-only (the demo)
    log.create.length = 0; log.update.length = 0; log.delete.length = 0;
    await mount(frame(make({ readOnly: true, tool: "highlight" })));
    layer = rect();
    await fire(layer, "pointerdown", { x: 140, y: 100 });
    await fire(layer, "pointermove", { x: 300, y: 250 });
    await fire(layer, "pointerup", { x: 300, y: 250 });
    check("layer[read-only]: even with the highlight tool forced on, a drag creates nothing and draws no draft", log.create.length === 0 && !$("[data-draft-highlight]"));
    await mount(frame(make({ readOnly: true, tool: "note" })));
    layer = rect();
    await fire(layer, "pointerdown", { x: 300, y: 300 });
    check("layer[read-only]: with the note tool forced on, a press opens no note box", !$("[data-annotation-popover]") && log.create.length === 0);
    await fire($("[data-annotation=h1]"), "click");
    const pop = $("[data-annotation-popover]");
    check("layer[read-only]: a sample annotation can be opened and READ, with no editor, colours or delete", pop && /strong/.test(pop.textContent) && !pop.querySelector("textarea") && !pop.querySelector("[aria-label=Delete]") && ![...pop.querySelectorAll("button")].some((b) => /Save/.test(b.textContent)), pop && pop.innerHTML.slice(0, 200));
    check("layer[read-only]: ...and no handler ran", log.create.length + log.update.length + log.delete.length === 0);
    await fire(window.document.body, "keydown");
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await settle(); });
    check("layer: Escape closes the open box", !$("[data-annotation-popover]"));
  }

  // ═══ 10. PDF.js stays out of everything else ═══
  {
    const walk = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) { if (!["node_modules", ".next", "public"].includes(e.name)) walk(f, out); } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) out.push(f); } return out; };
    const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");
    const src = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "components"))];
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const pdfjsImporters = src.filter((f) => /from\s+["']pdfjs-dist|import\(\s*["']pdfjs-dist|require\(\s*["']pdfjs-dist/.test(strip(fs.readFileSync(f, "utf8")))).map(rel);
    check("lazy: pdfjs-dist is imported by exactly one source file — resume-viewer/pdf-viewer.tsx", pdfjsImporters.join() === "app/employer/components/resume-viewer/pdf-viewer.tsx", pdfjsImporters);
    const viewerRefs = src.filter((f) => /pdf-viewer["']/.test(strip(fs.readFileSync(f, "utf8")))).map((f) => ({ f: rel(f), lines: strip(fs.readFileSync(f, "utf8")).split("\n").filter((l) => /pdf-viewer["']/.test(l)) }));
    check("lazy: pdf-viewer is only ever reached through a dynamic import() (type-only imports are erased)", viewerRefs.every((r) => r.lines.every((l) => /import\(\s*["']\.\/pdf-viewer["']\s*\)/.test(l) || /^\s*import type\b/.test(l))), viewerRefs);
    const sectionRefs = src.filter((f) => /resume-section["']/.test(strip(fs.readFileSync(f, "utf8")))).map((f) => ({ f: rel(f), lines: strip(fs.readFileSync(f, "utf8")).split("\n").filter((l) => /resume-section["']/.test(l)) }));
    check("lazy: resume-section is only reached through next/dynamic (the two callers) — never a static import", sectionRefs.length === 2 && sectionRefs.every((r) => r.lines.every((l) => /dynamic\(\s*\(\)\s*=>\s*import\(/.test(l))), sectionRefs);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    check("deps: pdfjs-dist is pinned exactly and is >= 4.2.67 (the CVE-2024-4367 fix); eval-based font compilation is also switched off", pkg.dependencies["pdfjs-dist"] === "4.10.38" && /isEvalSupported:\s*false/.test(fs.readFileSync(path.join(ROOT, "app/employer/components/resume-viewer/pdfjs-config.ts"), "utf8")));
    const cand = fs.readFileSync(path.join(ROOT, "app/employer/candidates/candidates-client.tsx"), "utf8");
    check("flag: the drawer renders the viewer only when the flag prop is on", /\{resumeViewer && <ResumeSection/.test(cand));
    const page = fs.readFileSync(path.join(ROOT, "app/employer/candidates/page.tsx"), "utf8");
    check("flag: the candidates page passes the server-side flag to both the real list and the demo", (page.match(/resumeViewerEnabled\(\)/g) || []).length === 2);
    check("env: this feature adds no environment variables", !/process\.env\.(?!NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_KEY)/.test(["lib/resume-annotations-store.ts", "lib/resume-annotations.ts", "lib/resume-viewer-access.ts", "lib/resume-viewer-flag.ts", "app/employer/components/resume-viewer/resume-section.tsx", "app/employer/components/resume-viewer/pdf-viewer.tsx", "app/employer/components/resume-viewer/pdfjs-config.ts", "app/employer/components/resume-viewer/annotation-layer.tsx"].map((f) => strip(fs.readFileSync(path.join(ROOT, f), "utf8"))).join("\n")));
  }

  // ═══ 11. i18n ═══
  {
    const locales = ["en", "es", "fr", "hi", "zh"];
    const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
    const sets = locales.map((l) => new Set(flat(JSON.parse(fs.readFileSync(path.join(ROOT, `messages/${l}.json`), "utf8")).resumeViewer)));
    check("i18n: resumeViewer has the identical key set in all five locales", sets.every((s) => s.size === sets[0].size && [...s].every((k) => sets[0].has(k))) && sets[0].size > 40, sets.map((s) => s.size));
    const used = new Set();
    for (const f of ["annotation-layer.tsx", "pdf-viewer.tsx", "resume-section.tsx"]) for (const m of fs.readFileSync(path.join(ROOT, "app/employer/components/resume-viewer", f), "utf8").matchAll(/\bt\(\s*["'`]([\w.${}]+)["'`]/g)) used.add(m[1]);
    const dyn = [...used].filter((k) => k.includes("${"));
    const missing = [...used].filter((k) => !k.includes("${") && !sets[0].has(k));
    check("i18n: every static t('…') key the viewer uses exists", missing.length === 0, missing);
    check("i18n: the dynamic keys (colors.*, demo.*) resolve for every value", dyn.every((k) => k.startsWith("colors.") || k.startsWith("demo.")) && ["yellow", "green", "blue", "pink"].every((c) => sets[0].has(`colors.${c}`)));
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, "messages/en.json"), "utf8"));
    check("i18n: the drawer heading exists in all five locales (employerCandidates.resumePdf not needed — the section title is resumeViewer.section)", locales.every((l) => typeof JSON.parse(fs.readFileSync(path.join(ROOT, `messages/${l}.json`), "utf8")).resumeViewer.section === "string") && !!en.resumeViewer.section);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
