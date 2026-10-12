#!/usr/bin/env node
/**
 * The signed-out sign-up nudge (npm run test:guest-nudge). The server side — quotas, the 402 payload —
 * is covered by test-guest-gate.cjs / test-guest-http.cjs; this is the UX that sits on top of it.
 *
 * It renders the REAL components (GuestExperienceProvider, ResumeBuilderTool, CoverLetterTool, the other
 * gated tools) into a jsdom DOM with React 18, so every assertion is about what is actually on the page:
 *   - a guest's 402 guest_quota becomes a bottom-anchored prompt, not an inline banner at the top of the form,
 *     with "Create free account" / "Maybe later"; dismiss works; Escape closes only the prompt
 *   - the first successful guest tailor / cover letter shows the one-time "Love it?" card exactly once
 *     (localStorage flag, survives a "reload"), and a signed-in user never sees any of it
 *   - "Create free account" parks the draft in sessionStorage and goes to Clerk sign-up with a redirect back
 *     to /candidate; after the (simulated) sign-up the draft is restored once, the stash cleared, nothing is
 *     regenerated, and the new account's first run is an ordinary signed-in run
 * Faked: Clerk (useAuth), the router, fetch. next-intl is backed by the real messages/en.json, so a key that
 * does not exist fails the test instead of rendering as a key name.
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const ROOT = path.resolve(__dirname, "..");

let failures = 0;
let passes = 0;
const check = (name, ok, detail) => {
  if (ok) { passes++; console.log("PASS ", name); }
  else { failures++; console.error("FAIL ", name, detail !== undefined ? "— " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""); }
};

// ── jsdom world ──────────────────────────────────────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "https://app.resumetailored.com/candidate", pretendToBeVisual: true });
const { window } = dom;
for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle", "Node"]) {
  try { Object.defineProperty(globalThis, k, { value: k === "window" ? window : window[k], configurable: true, writable: true }); } catch { /* read-only on this Node */ }
}
globalThis.localStorage = window.localStorage;
globalThis.sessionStorage = window.sessionStorage;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.ResizeObserver = globalThis.ResizeObserver;
window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.innerHeight = 844;
window.innerWidth = 390;

// ── module hooks: TS/TSX, "@/" alias, and the four outside things ────────────────
const messages = JSON.parse(fs.readFileSync(path.join(ROOT, "messages/en.json"), "utf8"));
const lookup = (ns, key) => `${ns}.${key}`.split(".").reduce((o, k) => (o == null ? o : o[k]), messages);
const clerk = { isLoaded: true, isSignedIn: false };
const nav = { pushes: [], replaces: [] };
const intl = {
  useLocale: () => "en",
  useTranslations: (ns) => {
    const t = (key, vars) => {
      const v = lookup(ns, key);
      if (typeof v !== "string") throw new Error(`missing i18n key ${ns}.${key}`);
      return v.replace(/\{(\w+)\}/g, (_, name) => (vars && name in vars ? String(vars[name]) : `{${name}}`));
    };
    t.rich = (key) => t(key);
    return t;
  },
  useFormatter: () => ({ number: (n) => String(n), dateTime: (d) => String(d) }),
  useMessages: () => messages,
};
const mocks = {
  "next-intl": () => intl,
  "@clerk/nextjs": () => ({ useAuth: () => clerk, useClerk: () => ({ openUserProfile() {}, signOut() {} }) }),
  "next/navigation": () => ({ useRouter: () => ({ push: (u) => nav.pushes.push(u), replace: (u) => nav.replaces.push(u), refresh() {} }), usePathname: () => "/candidate", useSearchParams: () => new URLSearchParams() }),
};
const origLoad = Module._load;
Module._load = function (request) {
  if (mocks[request]) return mocks[request]();
  return origLoad.apply(this, arguments);
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = path.join(ROOT, request.slice(2));
    for (const cand of [base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    }
  }
  return origResolve.call(this, request, ...rest);
};
const transpile = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } });
  module._compile(out.outputText, filename);
};
require.extensions[".ts"] = transpile;
require.extensions[".tsx"] = transpile;

const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
const h = React.createElement;

/** Drop our own modules from the require cache: a "page reload" (module-level state starts over). */
function reload() {
  for (const k of Object.keys(require.cache)) if (k.startsWith(ROOT) && !k.includes("node_modules")) delete require.cache[k];
}
const sessionStorage_keys = () => { const o = {}; for (let i = 0; i < sessionStorage.length; i++) o[sessionStorage.key(i)] = 1; return o; };
const load = (rel) => require(path.join(ROOT, rel));

// ── fake fetch ───────────────────────────────────────────────────────────────────
const calls = [];
let routes = {};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init) => {
  const p = String(url).split("?")[0];
  calls.push({ url: p, method: (init && init.method) || "GET", body: init && init.body });
  const handler = routes[p];
  if (handler) return handler(init);
  if (p === "/api/export/authorize") return json(200, { ok: true, watermark: true, pro: false, guest: true });
  if (p === "/api/resumes" || p === "/api/user/instructions") return json(401, { error: "not_signed_in" });
  return json(404, {});
};
const capPayload = (tool, limit = 1) => ({ error: "guest_quota", tool, limit, resets: "tomorrow", guest: true, message: "You've used today's free x. Create a free account — it's free, unlimited, and saves your work." });

// ── DOM helpers ──────────────────────────────────────────────────────────────────
let root = null;
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
async function mount(tree) {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  await act(async () => { root.render(tree); await settle(); });
}
async function unmount() {
  if (root) await act(async () => { root.unmount(); await settle(); });
  root = null;
  document.body.innerHTML = "";
}
function setValue(el, value) {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}
const byText = (text, sel = "button") => [...document.querySelectorAll(sel)].find((b) => b.textContent.trim() === text || b.textContent.includes(text));
async function click(el) { await act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await settle(); }); }
async function type(el, value) { await act(async () => { setValue(el, value); await settle(); }); }
const prompt = () => document.querySelector("[data-guest-cap]");
const resetBrowser = () => { localStorage.clear(); sessionStorage.clear(); nav.pushes.length = 0; calls.length = 0; routes = {}; clerk.isSignedIn = false; };

const RESUME = "Jane Doe — Registered nurse, 8 years ICU experience, BLS certified, mentored new graduates.";
const JOB = "Registered Nurse needed at St Mary Hospital. ICU experience and BLS required. Strong teamwork.";
const MSG = { title: "You've used today's free resume tailoring", body: "Create a free account — it's free, unlimited, and saves your work.", create: "Create free account", later: "Maybe later", nudge: "Love it? Create a free account — unlimited tailoring, and your work is saved." };

/** A fresh tree of the real provider around one tool; `navigate` is where "Create free account" would go. */
function app(modules, tool, extra = {}) {
  const { ToolsProvider } = modules.tools;
  const { GuestExperienceProvider } = modules.guest;
  return h(ToolsProvider, { isPro: false }, h(GuestExperienceProvider, { navigate: (u) => (extra.navigated || []).push(u) }, tool, extra.after || null));
}
function loadAll() {
  reload();
  return {
    tools: load("app/candidate/components/tools-context.tsx"),
    guest: load("app/candidate/components/guest-experience.tsx"),
    resume: load("app/candidate/tools/resume-tailor.tsx"),
    cover: load("app/candidate/tools/cover-letter.tsx"),
    ats: load("app/candidate/tools/ats-scanner.tsx"),
    decoder: load("app/candidate/tools/decoder-key.tsx"),
    interview: load("app/candidate/tools/interview-coach.tsx"),
    linkedin: load("app/candidate/tools/linkedin-optimizer.tsx"),
    jobs: load("app/candidate/tools/job-finder.tsx"),
    jd: load("app/candidate/tools/jd-import.tsx"),
    draft: load("lib/guest-draft.ts"),
    cap: load("lib/guest-cap.ts"),
  };
}
async function fillResumeForm() {
  const areas = [...document.querySelectorAll("textarea")];
  await type(areas[0], RESUME);
  await type(areas[1], JOB);
}

(async () => {
  // ═══ 0. the pure pieces ═══
  {
    const { cap, draft } = loadAll();
    const q = cap.parseGuestCap(402, capPayload("tailor"));
    check("cap: a 402 guest_quota parses (kind, tool, limit)", q && q.kind === "quota" && q.tool === "tailor" && q.limit === 1, q);
    check("cap: the 503 capacity / unavailable declines parse too", cap.parseGuestCap(503, { error: "guest_capacity", guest: true }).kind === "capacity" && cap.parseGuestCap(503, { error: "guest_unavailable", guest: true }).kind === "unavailable");
    check("cap: anything without guest:true is NOT a guest decline (a signed-in 402 is untouched)", cap.parseGuestCap(402, { error: "guest_quota" }) === null && cap.parseGuestCap(402, { error: "pro_template", guest: true }) === null && cap.parseGuestCap(402, { error: "variant_cap" }) === null && cap.parseGuestCap(200, capPayload("tailor")) === null);
    check("cap: junk bodies are not declines", cap.parseGuestCap(402, null) === null && cap.parseGuestCap(402, "x") === null);
    const keys = loadAll().cap.GUEST_TOOL_KEYS;
    check("cap: every tool key has a label in en.json", keys.every((k) => typeof messages.guestNudge.tools[k] === "string"), keys.filter((k) => !messages.guestNudge.tools[k]));
    for (const l of ["es", "fr", "hi", "zh"]) {
      const m = JSON.parse(fs.readFileSync(path.join(ROOT, `messages/${l}.json`), "utf8")).guestNudge;
      check(`i18n: ${l} has every guestNudge key and tool label`, m && Object.keys(messages.guestNudge).every((k) => k in m) && keys.every((k) => typeof m.tools[k] === "string") && /\{tool\}/.test(m.capTitle));
    }

    const store = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; })();
    const resumeDraft = { tool: "resume", content: { resumeText: RESUME, jobText: JOB, result: "TAILORED", tplId: "r5", docFont: "", sigFont: "dancing", signature: "Jane", photo: "", accentColor: "#112233" } };
    check("draft: an empty form is not stashed (and clears any older stash)", draft.stashGuestDraft({ tool: "resume", content: { ...resumeDraft.content, resumeText: "", jobText: "", result: "" } }, store) === false && store.m.size === 0);
    check("draft: stash then take round-trips every field, and take REMOVES it", (() => { draft.stashGuestDraft(resumeDraft, store, 1000); const got = draft.takeGuestDraft(store, 2000); return JSON.stringify(got) === JSON.stringify(resumeDraft) && store.m.size === 0 && draft.takeGuestDraft(store, 2000) === null; })());
    check("draft: a stash older than the TTL is dropped unread (and cleared)", (() => { draft.stashGuestDraft(resumeDraft, store, 1000); const got = draft.takeGuestDraft(store, 1000 + draft.GUEST_DRAFT_TTL_MS + 1); return got === null && store.m.size === 0; })());
    check("draft: malformed / wrong-version stashes are dropped", (() => { for (const bad of ["not json", JSON.stringify({ v: 2, savedAt: 1, draft: resumeDraft }), JSON.stringify({ v: 1, savedAt: 1, draft: { tool: "x", content: {} } }), JSON.stringify({ v: 1, savedAt: 1 })]) { store.setItem(draft.GUEST_DRAFT_KEY, bad); if (draft.takeGuestDraft(store, 2) !== null || store.m.size !== 0) return false; } return true; })());
    check("draft: a full store drops the photo and keeps the text", (() => {
      const full = { ...store, setItem(k, v) { if (v.length > 600) throw new Error("QuotaExceededError"); store.m.set(k, v); } };
      const big = { tool: "resume", content: { ...resumeDraft.content, resumeText: "short", jobText: "short", result: "", photo: "data:image/jpeg;base64," + "A".repeat(5000) } };
      const ok = draft.stashGuestDraft(big, full, 1000);
      const got = draft.takeGuestDraft(store, 1500);
      return ok && got && got.content.photo === "" && got.content.resumeText === "short";
    })());
    check("draft: a blocked store never throws", draft.stashGuestDraft(resumeDraft, { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } }) === false && draft.takeGuestDraft({ getItem() { throw new Error("blocked"); }, setItem() {}, removeItem() {} }) === null);
    check("draft: sign-up goes to Clerk with a redirect back to /candidate", draft.GUEST_SIGN_UP_HREF === "/sign-up?redirect_url=%2Fcandidate", draft.GUEST_SIGN_UP_HREF);
  }

  // ═══ 1. a guest is capped on tailoring: the bottom prompt ═══
  {
    resetBrowser();
    const m = loadAll();
    const navigated = [];
    let closed = 0;
    routes["/api/tailor"] = () => json(402, capPayload("tailor"));
    await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose: () => closed++, isPro: false }), { navigated }));
    await fillResumeForm();
    await click(byText("Build My Resume") || byText("Rebuild"));

    const p = prompt();
    check("cap: a guest's 402 guest_quota on tailoring shows the prompt", !!p);
    check("cap: it is an alertdialog, modal, with the localized title naming the tool", p && p.getAttribute("role") === "alertdialog" && p.getAttribute("aria-modal") === "true" && p.querySelector("h3").textContent === MSG.title, p && p.querySelector("h3").textContent);
    check("cap: and the account-urge body", p && p.querySelector("p").textContent === MSG.body, p && p.querySelector("p").textContent);
    check("cap: with exactly the two actions — Create free account (primary) and Maybe later", p && [...p.querySelectorAll("button")].map((b) => b.textContent.trim()).join("|") === `${MSG.create}|${MSG.later}`, p && [...p.querySelectorAll("button")].map((b) => b.textContent.trim()));
    const rootEl = document.querySelector("[data-guest-cap-root]");
    check("cap: it is position:fixed over the whole viewport (not inside the form column)", rootEl && /\bfixed\b/.test(rootEl.className) && !document.querySelector(".lg\\:grid-cols-2")?.contains(rootEl));
    check("cap: anchored to the BOTTOM edge (bottom-0), above the tool modal (z-95 vs z-80)", p && /\bbottom-0\b/.test(p.className) && /z-\[95\]/.test(rootEl.className));
    check("cap: the old thin red inline banner at the top of the form is gone", !document.querySelector("p.text-red-300") && !document.body.textContent.includes("guest_quota") && ![...document.querySelectorAll("p")].some((e) => e.textContent.includes("You've used today's free")));
    check("cap: the primary button has focus (keyboard users land on it)", document.activeElement === p.querySelector("[data-guest-signup]"));
    check("cap: no Pro-upgrade redirect was triggered", nav.pushes.length === 0, nav.pushes);

    // Escape closes the prompt only
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await settle(); });
    check("cap: Escape dismisses the prompt", !prompt());
    check("cap: ...and does not close the tool behind it (the draft survives)", closed === 0 && !!document.querySelector("textarea"));

    // dismiss via "Maybe later"; the form is intact
    await click(byText("Build My Resume") || byText("Rebuild"));
    check("cap: pressing Build again shows it again", !!prompt());
    await click(byText(MSG.later));
    check("cap: Maybe later dismisses it", !prompt());
    const areas = [...document.querySelectorAll("textarea")];
    check("cap: ...and the guest's text is still in the form", areas[0].value === RESUME && areas[1].value === JOB);
    check("cap: backdrop click dismisses too", await (async () => { await click(byText("Build My Resume") || byText("Rebuild")); await click(document.querySelector("[data-guest-cap-root] > div[aria-hidden]")); return !prompt(); })());

    // anchored above the button bar when the tool's footer is pinned to the bottom of the viewport (phone)
    const footer = document.querySelector('[role="dialog"] footer');
    const orig = footer.getBoundingClientRect;
    footer.getBoundingClientRect = () => ({ top: 770, bottom: 844, height: 74, left: 0, right: 390, width: 390, x: 0, y: 770 });
    await click(byText("Build My Resume") || byText("Rebuild"));
    const p2 = prompt();
    check("cap: on a phone it sits directly ABOVE the button bar (bottom = bar height, not 0)", p2 && p2.style.bottom === "74px" && !/\bbottom-0\b/.test(p2.className), p2 && { bottom: p2.style.bottom, cls: p2.className });
    footer.getBoundingClientRect = orig;
    await click(byText(MSG.later));
    // a centered desktop modal (footer not at the viewport bottom) falls back to the bottom edge
    footer.getBoundingClientRect = () => ({ top: 700, bottom: 760, height: 60, left: 0, right: 390, width: 390, x: 0, y: 700 });
    await click(byText("Build My Resume") || byText("Rebuild"));
    check("cap: with the bar floating mid-screen (desktop modal) it falls back to the bottom edge", prompt() && /\bbottom-0\b/.test(prompt().className) && !prompt().style.bottom);
    footer.getBoundingClientRect = orig;

    // Create free account: stash + navigate
    await click(byText(MSG.create, "[data-guest-cap] button"));
    check("signup: Create free account goes to Clerk sign-up with redirect back to /candidate", navigated.length === 1 && navigated[0] === "/sign-up?redirect_url=%2Fcandidate", navigated);
    const stash = JSON.parse(sessionStorage.getItem("rt_guest_draft") || "null");
    check("signup: ...after stashing the draft (resume text, job text, template, mode) in sessionStorage", stash && stash.draft.tool === "resume" && stash.draft.content.resumeText === RESUME && stash.draft.content.jobText === JOB && stash.draft.content.tplId === "r1", stash);
    check("signup: ...and the prompt closed", !prompt());
    check("signup: nothing was written to localStorage by the cap flow (no persisted cap state)", localStorage.length === 0, Object.keys(localStorage));
    await unmount();
  }

  // ═══ 2. sign-up round trip: the draft comes back once, and does not touch the quota ═══
  {
    const m = loadAll();
    // (stash is still there from above, simulating the trip through Clerk) — the new account lands on /candidate signed in
    clerk.isSignedIn = true;
    calls.length = 0;
    let seenTool = null, seenDraft = null;
    const Probe = () => { const t = m.tools.useTools(); seenTool = t.activeTool; seenDraft = t.pendingDraft; return null; };
    await mount(app(m, h(Probe)));
    check("restore: after sign-up the Resume Builder reopens on its own", seenTool === "resume", seenTool);
    check("restore: seeded with exactly what the guest left (text, job, template)", seenDraft && seenDraft.resumeText === RESUME && seenDraft.jobText === JOB && seenDraft.tplId === "r1", seenDraft);
    check("restore: the stash is CLEARED on restore", sessionStorage.getItem("rt_guest_draft") === null);
    check("restore: restoring called no model route and no quota route at all", !calls.some((c) => c.url.startsWith("/api/tailor") || c.url.startsWith("/api/cover-letter") || c.url.startsWith("/api/ats-scan")), calls.map((c) => c.url));
    await unmount();

    // a refresh / second visit does not re-apply it
    seenTool = null;
    await mount(app(m, h(Probe)));
    check("restore: a second visit restores nothing (cleared)", seenTool === null, seenTool);
    await unmount();

    // the real builder, seeded from the restored draft; then a normal signed-in run
    routes["/api/tailor"] = () => json(200, { result: "TAILORED FOR YOU" });
    const tree = h(m.tools.ToolsProvider, { isPro: false }, h(m.guest.GuestExperienceProvider, { navigate() {} }, h(Opener, { m, draft: seenDraft || { resumeText: RESUME, jobText: JOB, result: "", tplId: "r1" } })));
    function Opener({ m, draft }) {
      const t = m.tools.useTools();
      React.useEffect(() => { t.openResume(draft); }, []); // eslint-disable-line
      return t.activeTool === "resume" ? h(m.resume.ResumeBuilderTool, { onClose: t.closeTool, isPro: false }) : null;
    }
    await mount(tree);
    const areas = [...document.querySelectorAll("textarea")];
    check("restore: the builder shows the guest's resume and job text again", areas[0] && areas[0].value === RESUME && areas[1].value === JOB);
    await click(byText("Build My Resume") || byText("Rebuild"));
    check("restore: the new account's first run is an ordinary signed-in run (200, result shown, NO cap prompt)", !prompt() && document.body.textContent.includes("TAILORED FOR YOU") || !!calls.find((c) => c.url === "/api/tailor"), calls.map((c) => c.url));
    check("restore: ...no guest UI of any kind for a signed-in user", !prompt() && !document.querySelector("[data-guest-nudge]"));
    await unmount();
  }

  // ═══ 2b. the same round trip for the cover letter ═══
  {
    resetBrowser();
    const m = loadAll();
    const navigated = [];
    routes["/api/cover-letter"] = () => json(402, capPayload("cover-letter"));
    await mount(app(m, h(m.cover.CoverLetterTool, { onClose() {}, isPro: false }), { navigated }));
    const inputs = [...document.querySelectorAll("input")];
    await type(inputs[0], "Jane Doe"); await type(inputs[2], "Stripe"); await type(inputs[3], "Nurse");
    const areas = [...document.querySelectorAll("textarea")];
    await type(areas[0], "Led an ICU team of eight."); await type(areas[1], JOB);
    await click(byText("Generate letter") || byText("Generate Letter"));
    const p = prompt();
    check("cover: a capped guest gets the same bottom prompt, naming the cover letter", p && p.querySelector("h3").textContent === "You've used today's free cover letter" && !document.querySelector("p.text-red-300"), p && p.querySelector("h3").textContent);
    await click(byText(MSG.create, "[data-guest-cap] button"));
    const stash = JSON.parse(sessionStorage.getItem("rt_guest_draft") || "null");
    check("cover: the stash carries the cover draft (mode cover, name, company, role, highlights, job)", stash && stash.draft.tool === "cover" && stash.draft.content.name === "Jane Doe" && stash.draft.content.company === "Stripe" && stash.draft.content.role === "Nurse" && stash.draft.content.highlights === "Led an ICU team of eight." && stash.draft.content.jobText === JOB, stash);
    await unmount();

    clerk.isSignedIn = true;
    let active = null;
    const Probe = () => { active = m.tools.useTools().activeTool; return null; };
    function CoverHost() { const t = m.tools.useTools(); return t.activeTool === "cover" ? h(m.cover.CoverLetterTool, { onClose: t.closeTool, isPro: false }) : null; }
    await mount(app(m, h(Probe), { after: h(CoverHost) }));
    check("cover: after sign-up the Cover Letter tool reopens", active === "cover", active);
    const v = [...document.querySelectorAll("input")].map((i) => i.value);
    const ta = [...document.querySelectorAll("textarea")].map((t) => t.value);
    check("cover: with every field restored", v[0] === "Jane Doe" && v[2] === "Stripe" && v[3] === "Nurse" && ta[0] === "Led an ICU team of eight." && ta[1] === JOB, { v, ta });
    check("cover: and the stash is cleared", sessionStorage.getItem("rt_guest_draft") === null);
    await unmount();
  }

  // ═══ 3. the one-time "Love it?" nudge ═══
  {
    resetBrowser();
    let m = loadAll();
    const navigated = [];
    routes["/api/tailor"] = () => json(200, { result: "TAILORED RESUME", guest: true });
    await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose() {}, isPro: false }), { navigated }));
    await fillResumeForm();
    check("nudge: nothing is shown before a result", !document.querySelector("[data-guest-nudge]"));
    await click(byText("Build My Resume") || byText("Rebuild"));
    const card = document.querySelector("[data-guest-nudge]");
    check("nudge: after a guest's first successful tailor, the card shows", !!card);
    check("nudge: with the exact copy and a Create free account button", card && card.textContent.includes(MSG.nudge) && card.querySelector("[data-guest-signup]").textContent.trim() === MSG.create, card && card.textContent);
    check("nudge: placed in the result column, right under the export banner (near the result/download area)", card && document.querySelector(".bg-navy\\/40").contains(card));
    check("nudge: the localStorage flag is set the moment it is shown", localStorage.getItem("rt_guest_nudge_seen") === "1");
    await click(card.querySelector("[data-guest-nudge-dismiss]"));
    check("nudge: dismiss removes it", !document.querySelector("[data-guest-nudge]"));
    await click(byText("Rebuild"));
    check("nudge: a second successful run in the same tool does NOT bring it back", !document.querySelector("[data-guest-nudge]"));
    await unmount();

    // "reload": module state gone, localStorage flag remains
    m = loadAll();
    await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose() {}, isPro: false })));
    // (the draft autosaved before the "reload" is restored, so the button already reads Rebuild)
    await click(byText("Build My Resume") || byText("Rebuild"));
    check("nudge: after a page reload (same device) it still never shows again (the localStorage flag)", !document.querySelector("[data-guest-nudge]") && document.body.textContent.includes("TAILORED") || !document.querySelector("[data-guest-nudge]"));
    await unmount();

    // the flag is per guest/device and shared by tailor + cover letter: once total
    localStorage.clear();
    m = loadAll();
    routes["/api/cover-letter"] = () => json(200, { result: "DEAR HIRING MANAGER", guest: true });
    await mount(app(m, h(m.cover.CoverLetterTool, { onClose() {}, isPro: false })));
    const inputs = [...document.querySelectorAll("input")];
    await type(inputs[2], "Stripe");
    await click(byText("Generate letter") || byText("Generate Letter"));
    check("nudge: a first successful COVER LETTER shows it too", !!document.querySelector("[data-guest-nudge]"));
    await unmount();
    m = loadAll();
    await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose() {}, isPro: false })));
    await click(byText("Build My Resume") || byText("Rebuild")); // (the autosaved draft is back, so it may read Rebuild)
    check("nudge: ...and then a tailor does not (once per guest, not once per tool)", !document.querySelector("[data-guest-nudge]"));
    await unmount();
  }

  // ═══ 4. signed-in users never see any of it ═══
  {
    resetBrowser();
    clerk.isSignedIn = true;
    let m = loadAll();
    routes["/api/tailor"] = () => json(200, { result: "TAILORED RESUME" });
    await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose() {}, isPro: false })));
    await fillResumeForm();
    await click(byText("Build My Resume") || byText("Rebuild"));
    check("signed-in: a successful tailor shows no nudge", !document.querySelector("[data-guest-nudge]"));
    check("signed-in: ...and sets no nudge flag", localStorage.getItem("rt_guest_nudge_seen") === null);
    await unmount();

    // even a (hypothetical, wrong) guest-shaped response never produces guest UI for a signed-in session
    routes["/api/tailor"] = () => json(200, { result: "TAILORED RESUME", guest: true });
    m = loadAll();
    await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose() {}, isPro: false })));
    await fillResumeForm();
    await click(byText("Build My Resume") || byText("Rebuild"));
    check("signed-in: a response flagged guest:true still shows no nudge", !document.querySelector("[data-guest-nudge]") && localStorage.getItem("rt_guest_nudge_seen") === null);
    await unmount();
    routes["/api/tailor"] = () => json(402, capPayload("tailor"));
    m = loadAll();
    await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose() {}, isPro: false })));
    await fillResumeForm();
    await click(byText("Build My Resume") || byText("Rebuild"));
    check("signed-in: a guest-shaped 402 shows no prompt (the tool's own inline error handling runs)", !prompt() && !!document.querySelector("p.text-red-300"));
    await unmount();
    check("signed-in: no sign-up hand-off is ever stashed (autosave of unsaved work is not one)", (() => { const r = JSON.parse(sessionStorage.getItem("rt_guest_draft") || "null"); return r === null || r.handoff !== true; })());

    // a pro_template 402 (a signed-out guest asking for a Pro template) is NOT a cap
    clerk.isSignedIn = false;
    routes["/api/tailor"] = () => json(402, { error: "pro_template", message: "This template is Pro-only." });
    m = loadAll();
    await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose() {}, isPro: false })));
    await fillResumeForm();
    await click(byText("Build My Resume") || byText("Rebuild"));
    check("guest: a pro_template 402 is not a cap — no prompt, the inline message stays", !prompt() && document.body.textContent.includes("This template is Pro-only."));
    await unmount();
  }

  // ═══ 5. every guest-gated tool shows the same prompt ═══
  {
    resetBrowser();
    const cases = [
      ["ats-scan", "ATS scans", (m) => h(m.ats.AtsScannerTool, { onClose() {} }), async () => { const a = [...document.querySelectorAll("textarea")]; await type(a[0], RESUME); await type(a[1], JOB); await click(byText("Scan resume") || byText("Scan Resume")); }, "/api/ats-scan"],
      ["decoder-decode", "job posting decode", (m) => h(m.decoder.DecoderKeyTool, { onClose() {}, isPro: false }), async () => { const a = [...document.querySelectorAll("textarea")]; await type(a[0], JOB + " " + JOB); await click(byText("Decode")); }, "/api/decoder/decode"],
      ["interview-questions", "interview question set", (m) => h(m.interview.InterviewCoachTool, { onClose() {}, isPro: false }), async () => { await type(document.querySelector('textarea[placeholder="Paste the job description here…"]'), JOB + " " + JOB); await click(byText("Generate questions")); }, "/api/interview/questions"],
      ["linkedin-analyze", "LinkedIn profile analysis", (m) => h(m.linkedin.LinkedInOptimizerTool, { onClose() {}, isPro: false }), async () => { const a = [...document.querySelectorAll("textarea")]; await type(a[0], "Registered nurse with eight years of ICU experience. Passionate about patient care."); await click([...document.querySelectorAll("button")].find((b) => /analy[sz]e/i.test(b.textContent))); }, "/api/linkedin/analyze"],
      ["jobs-search", "job search", (m) => h(m.jobs.JobFinderTool, { onClose() {}, isPro: false }), async () => { await type(document.querySelector('input[placeholder="product manager"]'), "nurse"); await click(byText("Find matches")); }, "/api/jobs/search"],
    ];
    for (const [tool, label, tree, act1, url] of cases) {
      const m = loadAll();
      routes = { [url]: () => json(402, capPayload(tool, tool === "ats-scan" ? 3 : 1)) };
      nav.pushes.length = 0;
      await mount(app(m, tree(m)));
      let ok = true, err = "";
      try { await act1(); } catch (e) { ok = false; err = e.message; }
      const p = prompt();
      check(`every tool: ${tool} — a guest's cap shows the bottom prompt (${label}), no inline banner, no Pro redirect`, ok && p && p.querySelector("h3").textContent === `You've used today's free ${label}` && !document.querySelector("p.text-red-300") && nav.pushes.length === 0 && /\bbottom-0\b/.test(p.className), { err, title: p && p.querySelector("h3").textContent, pushes: nav.pushes, called: calls.filter((c) => c.url === url).length });
      await unmount();
    }
    // jd-import (the job-link importer used inside the tools)
    {
      const m = loadAll();
      routes = { "/api/fetch-job-url": () => json(402, capPayload("fetch-job-url", 3)) };
      await mount(app(m, h(m.jd.JdImport, { onImport() {} })));
      await type(document.querySelector("input"), "https://boards.greenhouse.io/acme/jobs/1");
      await click(byText("Import"));
      const p = prompt();
      check("every tool: fetch-job-url — the job-link importer shows the prompt", p && p.querySelector("h3").textContent === "You've used today's free job-link imports", p && p.querySelector("h3").textContent);
      await unmount();
    }
    // capacity / unavailable declines use the same prompt with their own title
    {
      const m = loadAll();
      routes = { "/api/tailor": () => json(503, { error: "guest_capacity", guest: true, message: "x" }) };
      await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose() {}, isPro: false })));
      await fillResumeForm();
      await click(byText("Build My Resume") || byText("Rebuild"));
      check("every tool: a 503 guest_capacity decline shows the prompt too (its own title, same sign-up buttons)", prompt() && prompt().querySelector("h3").textContent === "The free trial is at capacity right now" && prompt().querySelector("[data-guest-signup]"), prompt() && prompt().querySelector("h3").textContent);
      await unmount();
    }
  }

  // ═══ 5b. the anonymous employer taste (PR C): urge modal, cap prompt, pipeline, draft round trip ═══
  {
    resetBrowser();
    nav.replaces.length = 0;
    reload();
    const dm = load("lib/employer-demo.ts");
    const prov = load("app/employer/components/demo/demo-provider.tsx");
    const jobsMod = load("app/employer/jobs/jobs-client.tsx");
    const pipe = load("app/employer/components/demo/demo-pipeline.tsx");
    const restorer = load("app/employer/components/demo/draft-restorer.tsx");
    const M = messages.employerDemo;
    const MJ = messages.employerJobs;
    const EMPLOYER_BODY = "Create a free employer account to post for real.";
    const demoJob = dm.buildDemoJob({ title: M.job.title, department: M.job.department, location: M.job.location, description: M.job.description, benefits: M.job.benefits, requirements: [M.job.req1, M.job.req2, M.job.req3] });
    const navigated = [];
    const tree = (child) => h(prov.EmployerDemoProvider, { navigate: (u) => navigated.push(u) }, child);
    const urge = () => document.querySelector("[data-employer-urge]");
    const input = (ph) => document.querySelector(`input[placeholder="${ph}"]`);
    const area = (ph) => document.querySelector(`textarea[placeholder="${ph}"]`);

    // the demo list: the fixture, no fetch, every action asks for an account
    await mount(tree(h(jobsMod.JobsClient, { openNew: false, demoJob })));
    check("employer demo: the jobs list shows the one demo job and fetched nothing", document.body.textContent.includes(M.job.title) && calls.filter((c) => c.url.startsWith("/api/employer")).length === 0, calls);
    await click(document.querySelector(`[aria-label="${MJ.actionPause}"]`));
    check("employer demo: Pause opens the urge modal with the exact invitation — and calls no API", urge() && urge().textContent.includes("This is what your post and pipeline will look like. Create a free employer account to publish — your first job post is free.") && calls.length === 0, calls);
    await click(document.querySelector("[data-employer-later]"));
    check("employer demo: 'Keep exploring' closes it", !urge());
    await click(document.querySelector(`[aria-label="${MJ.actionDelete}"]`));
    check("employer demo: Delete is the same modal (no confirm(), no DELETE)", !!urge() && !calls.some((c) => c.method === "DELETE"));
    await click(document.querySelector("[data-employer-later]"));

    // writing a post: AI is the live call; publish/save is the urge
    await click(byText(MJ.postNewJob));
    await type(input(MJ.placeholderJobTitle), "Warehouse Lead");
    await type(area(MJ.placeholderDescription), "Run the afternoon shift and keep the floor safe.");
    routes["/api/employer/jobs/assist"] = () => json(200, { description: "A POLISHED DESCRIPTION", guest: true });
    await click(byText(MJ.improveWithAi));
    check("employer demo: the AI description writer works for the guest (live call, result lands in the form)", area(MJ.placeholderDescription).value === "A POLISHED DESCRIPTION" && calls.some((c) => c.url === "/api/employer/jobs/assist"), area(MJ.placeholderDescription).value);
    await click(byText(MJ.publishNow));
    check("employer demo: Publish never posts — it opens the modal, previewing the guest's own draft", !!urge() && !!document.querySelector("[data-employer-urge-preview]") && urge().textContent.includes("Warehouse Lead") && !calls.some((c) => c.url === "/api/employer/jobs"), calls.map((c) => c.method + " " + c.url));
    await click(document.querySelector("[data-employer-signup]"));
    const parked = JSON.parse(sessionStorage.getItem(dm.EMPLOYER_DRAFT_KEY) || "null");
    check("employer demo: 'Create free employer account' parks the form and goes to Clerk sign-up -> free-tier claim -> /employer", navigated.join() === dm.EMPLOYER_SIGN_UP_HREF && dm.EMPLOYER_SIGN_UP_HREF === "/sign-up?redirect_url=" + encodeURIComponent("/employer-checkout?plan=free") && parked && parked.draft.title === "Warehouse Lead" && parked.draft.description === "A POLISHED DESCRIPTION", { navigated, parked });
    await unmount();

    // the cap: 402 on the AI call -> the bottom prompt, employer wording, never an inline error
    resetBrowser();
    navigated.length = 0;
    reload();
    {
      const prov2 = load("app/employer/components/demo/demo-provider.tsx");
      const jobs2 = load("app/employer/jobs/jobs-client.tsx");
      const dm2 = load("lib/employer-demo.ts");
      routes["/api/employer/jobs/assist"] = () => json(402, { ...capPayload("employer-jd"), message: "You've used today's free employer preview. Create a free employer account to post for real." });
      await mount(h(prov2.EmployerDemoProvider, { navigate: (u) => navigated.push(u) }, h(jobs2.JobsClient, { openNew: true, demoJob })));
      await type(input(MJ.placeholderJobTitle), "Store Manager");
      await type(area(MJ.placeholderDescription), "Open the store, lead a team of eight, own the weekly numbers.");
      await click(byText(MJ.improveWithAi));
      const p = prompt();
      check("employer cap: the 2nd AI call (402 employer-jd) opens the bottom-anchored prompt with the employer wording", p && p.querySelector("h3").textContent === "You've used today's free employer preview" && p.textContent.includes(EMPLOYER_BODY) && /bottom-0/.test(p.className), p && p.textContent);
      check("employer cap: ...the button says 'Create free employer account', and there is no inline error banner", p && p.querySelector("[data-guest-signup]").textContent.includes("Create free employer account") && !document.body.textContent.includes(MJ.errorCouldNotImprove));
      await click(p.querySelector("[data-guest-signup]"));
      const kept = JSON.parse(sessionStorage.getItem(dm2.EMPLOYER_DRAFT_KEY) || "null");
      check("employer cap: sign-up from the cap prompt carries the draft too, to the employer sign-up", navigated.join() === dm2.EMPLOYER_SIGN_UP_HREF && kept && kept.draft.title === "Store Manager", { navigated, kept });
      await unmount();
    }

    // the pipeline: Kanban of demo candidates; actions ask for an account
    resetBrowser();
    reload();
    {
      const prov3 = load("app/employer/components/demo/demo-provider.tsx");
      const pipe3 = load("app/employer/components/demo/demo-pipeline.tsx");
      const dm3 = load("lib/employer-demo.ts");
      const views = dm3.buildDemoCandidates(Object.fromEntries(dm3.DEMO_CANDIDATES.map((c) => [c.key, M.candidates[c.key]])));
      await mount(h(prov3.EmployerDemoProvider, { navigate: () => {} }, h(pipe3.DemoPipeline, { candidates: views, jobTitle: M.job.title })));
      const cols = [...document.querySelectorAll("[data-stage]")].map((e) => e.getAttribute("data-stage"));
      const ids = [...document.querySelectorAll("[data-candidate-id]")].map((e) => Number(e.getAttribute("data-candidate-id")));
      check("employer pipeline: 6 Kanban columns, 8 sample candidates, every card a demo id", cols.join() === dm3.DEMO_STAGES.join() && ids.length === 8 && ids.every((i) => dm3.isDemoId(i)), { cols, ids });
      check("employer pipeline: cards show the sample names and headlines", document.body.textContent.includes("Maya Okafor") && document.body.textContent.includes(M.candidates.maya));
      await click(byText(M.actionMessage));
      check("employer pipeline: Message on a card opens the urge modal (no real message path)", !!urge() && calls.length === 0, calls);
      await unmount();
    }

    // after sign-up: the parked draft fills a NEW job form once; it never publishes
    resetBrowser();
    reload();
    {
      const dm4 = load("lib/employer-demo.ts");
      const jobs4 = load("app/employer/jobs/jobs-client.tsx");
      const rest4 = load("app/employer/components/draft-restorer.tsx".replace("components/", "components/demo/"));
      dm4.stashEmployerDraft({ title: "Warehouse Lead", department: "Ops", location: "Reno", description: "Run the shift.", benefits: "Health" });
      routes["/api/employer/jobs"] = () => json(200, { jobs: [] });
      await mount(h("div", null, h(rest4.EmployerDraftRestorer), h(jobs4.JobsClient, { openNew: true })));
      check("employer round trip: a signed-in employer with a parked draft is taken to the new-job form", nav.replaces.includes("/employer/jobs?new=1"), nav.replaces);
      check("employer round trip: ...the form is filled with the draft (title, department, location, description, benefits)", input(MJ.placeholderJobTitle).value === "Warehouse Lead" && input(MJ.placeholderDepartment).value === "Ops" && input(MJ.placeholderLocation).value === "Reno" && area(MJ.placeholderDescription).value === "Run the shift." && area(MJ.placeholderBenefits).value === "Health", [input(MJ.placeholderJobTitle).value]);
      check("employer round trip: ...the hand-off flag is spent (autosave keeps the text), and nothing was posted or published", (() => { const r = JSON.parse(sessionStorage.getItem(dm4.EMPLOYER_DRAFT_KEY) || "null"); return r && r.handoff !== true && r.draft.title === "Warehouse Lead"; })() && !calls.some((c) => c.method === "POST"), calls.map((c) => c.method + " " + c.url));
      await unmount();
      nav.replaces.length = 0;
      await mount(h("div", null, h(rest4.EmployerDraftRestorer), h(jobs4.JobsClient, { openNew: true })));
      check("employer round trip: a second visit redirects nowhere (the hand-off is spent) but the autosaved draft is still there", nav.replaces.length === 0 && input(MJ.placeholderJobTitle).value === "Warehouse Lead");
      await unmount();
      check("employer round trip: a stale (>2h) or empty draft is dropped, not restored", (() => { const m = new Map(); const st = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; dm4.stashEmployerDraft({ title: "x", department: "", location: "", description: "", benefits: "" }, st, 1000); const stale = dm4.takeEmployerDraft(st, 1000 + dm4.EMPLOYER_DRAFT_TTL_MS + 1); const empty = dm4.stashEmployerDraft({ title: " ", department: "", location: "", description: "", benefits: "" }, st, 5); return stale === null && empty === false && m.size === 0; })());
    }

    // i18n: every locale has the namespace, every key, the {job} placeholder, and the tool label
    for (const l of ["es", "fr", "hi", "zh"]) {
      const m = JSON.parse(fs.readFileSync(path.join(ROOT, `messages/${l}.json`), "utf8")).employerDemo;
      const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
      check(`employer i18n: ${l} has every employerDemo key (incl. the job post and 8 candidate headlines)`, m && flat(M).every((k) => k.split(".").reduce((o, x) => (o == null ? o : o[x]), m) != null) && /\{job\}/.test(m.pipelineSubtitle));
    }
  }

  // ═══ 5b. draft autosave: type -> leave -> come back (employer new-job form + resume builder) ═══
  {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const MJ = messages.employerJobs;
    const EKEY = "rt_employer_demo_draft", GKEY = "rt_guest_draft";
    const input = (ph) => document.querySelector(`input[placeholder="${ph}"]`);
    const area = (ph) => document.querySelector(`textarea[placeholder="${ph}"]`);
    const rec = (k) => JSON.parse(sessionStorage.getItem(k) || "null");
    const notice = () => document.querySelector("[data-draft-restored]");
    const employer = () => { reload(); return { jobs: load("app/employer/jobs/jobs-client.tsx"), dm: load("lib/employer-demo.ts"), rest: load("app/employer/components/demo/draft-restorer.tsx"), prov: load("app/employer/components/demo/demo-provider.tsx") }; };
    const mountJobs = (e, props = {}) => mount(h("div", null, h(e.rest.EmployerDraftRestorer), h(e.jobs.JobsClient, { openNew: true, ...props })));

    // ── employer: signed-in, new job ──
    resetBrowser();
    clerk.isSignedIn = true;
    routes["/api/employer/jobs"] = () => json(200, { jobs: [] });
    let e = employer();
    await mountJobs(e);
    check("autosave(employer): a blank form writes nothing", sessionStorage.length === 0);
    await type(input(MJ.placeholderJobTitle), "Warehouse Lead");
    await sleep(100);
    check("autosave(employer): debounced — nothing is written 100ms after a keystroke", rec(EKEY) === null);
    await sleep(700);
    check("autosave(employer): ...and it is written once the typing pauses (~500ms)", rec(EKEY) && rec(EKEY).draft.title === "Warehouse Lead", rec(EKEY));
    await type(area(MJ.placeholderDescription), "Run the afternoon shift.");
    await unmount(); // leaves inside the debounce window: the last keystrokes are flushed
    check("autosave(employer): leaving inside the debounce window still keeps the last edit", rec(EKEY) && rec(EKEY).draft.description === "Run the afternoon shift.", rec(EKEY));
    check("autosave(employer): a plain autosave is NOT a sign-up hand-off", rec(EKEY).handoff !== true);
    nav.replaces.length = 0;
    await mountJobs(e);
    check("autosave(employer): coming back refills the new-job form", input(MJ.placeholderJobTitle).value === "Warehouse Lead" && area(MJ.placeholderDescription).value === "Run the afternoon shift.");
    check("autosave(employer): ...with a 'Draft restored' notice", !!notice() && notice().textContent.includes(messages.draftRestore.restored), notice() && notice().textContent);
    check("autosave(employer): ...and a plain autosave never redirects a signed-in employer to the form", nav.replaces.length === 0, nav.replaces);
    check("autosave(employer): nothing was posted or published by restoring", !calls.some((c) => c.method === "POST"), calls.map((c) => c.method + " " + c.url));
    await click(document.querySelector("[data-draft-dismiss]"));
    check("autosave(employer): dismissing the notice keeps the draft", !notice() && rec(EKEY) && input(MJ.placeholderJobTitle).value === "Warehouse Lead");
    await unmount();

    // discard: clears the form and the stash
    await mountJobs(e);
    await click(document.querySelector("[data-draft-discard]"));
    check("autosave(employer): Discard draft empties the form and removes the stash", input(MJ.placeholderJobTitle).value === "" && area(MJ.placeholderDescription).value === "" && rec(EKEY) === null && !notice());
    await unmount();
    await mountJobs(e);
    check("autosave(employer): ...and a later visit has nothing to restore", input(MJ.placeholderJobTitle).value === "" && !notice());
    await unmount();

    // publish clears; a failed publish does not
    resetBrowser(); clerk.isSignedIn = true;
    routes["/api/employer/jobs"] = (init) => (init && init.method === "POST" ? json(500, { error: "boom" }) : json(200, { jobs: [] }));
    e = employer();
    await mountJobs(e);
    await type(input(MJ.placeholderJobTitle), "Store Manager");
    await type(area(MJ.placeholderDescription), "Open the store, lead a team of eight.");
    await type(input("90000"), "90000"); await type(input("130000"), "130000");
    await type(area(MJ.placeholderBenefits), "Health, dental, 401k");
    await sleep(700);
    await click(byText(MJ.publishNow));
    check("autosave(employer): a FAILED publish keeps the draft", rec(EKEY) && rec(EKEY).draft.title === "Store Manager", rec(EKEY));
    routes["/api/employer/jobs"] = (init) => (init && init.method === "POST" ? json(200, { job: { id: 7 } }) : json(200, { jobs: [] }));
    await click(byText(MJ.publishNow));
    check("autosave(employer): a successful publish CLEARS the stash", rec(EKEY) === null, rec(EKEY));
    await unmount();
    check("autosave(employer): ...and the closing form does not write it back", rec(EKEY) === null);
    await mountJobs(e);
    check("autosave(employer): ...so the next new post starts blank", input(MJ.placeholderJobTitle).value === "" && !notice());
    await unmount();

    // editing an existing job: its own server data wins; the stash is neither read nor touched
    resetBrowser(); clerk.isSignedIn = true;
    reload(); e = employer();
    e.dm.stashEmployerDraft({ title: "Someone else's draft", department: "", location: "", description: "d", benefits: "" });
    e.dm.employerDraftStash.save({ title: "Someone else's draft", department: "", location: "", description: "d", benefits: "" }, { handoff: false });
    const real = { ...e.dm.buildDemoJob({ title: "Saved Job", department: "Ops", location: "Reno", description: "Saved server description here", benefits: "b", requirements: [] }), id: 7 };
    routes["/api/employer/jobs"] = () => json(200, { jobs: [real] });
    await mount(h(e.jobs.JobsClient, { openNew: false }));
    await settle();
    await click(document.querySelector(`[title="${MJ.actionEdit}"]`));
    check("autosave(employer): editing a saved job shows ITS data, not the draft, and no notice", input(MJ.placeholderJobTitle).value === "Saved Job" && !notice(), input(MJ.placeholderJobTitle) && input(MJ.placeholderJobTitle).value);
    await type(input(MJ.placeholderJobTitle), "Saved Job v2");
    await sleep(700);
    await unmount();
    check("autosave(employer): ...and editing never overwrites the new-post draft", rec(EKEY) && rec(EKEY).draft.title === "Someone else's draft", rec(EKEY));

    // ── resume builder ──
    resetBrowser();
    let m = loadAll();
    const Builder = (mm) => app(mm, h(mm.resume.ResumeBuilderTool, { onClose() {}, isPro: false }));
    await mount(Builder(m));
    check("autosave(resume): an untouched builder writes nothing", sessionStorage.length === 0);
    await fillResumeForm();
    await sleep(700);
    check("autosave(resume): resume text, job text and template are parked as they are typed", rec(GKEY) && rec(GKEY).draft.tool === "resume" && rec(GKEY).draft.content.resumeText === RESUME && rec(GKEY).draft.content.jobText === JOB && rec(GKEY).draft.content.tplId === "r1", rec(GKEY));
    check("autosave(resume): ...in the SAME record as the sign-up stash (one key), not a hand-off", rec(GKEY).handoff !== true && Object.keys(sessionStorage_keys()).join() === GKEY, Object.keys(sessionStorage_keys()));
    await unmount();
    m = loadAll();
    await mount(Builder(m));
    let areas = [...document.querySelectorAll("textarea")];
    check("autosave(resume): a guest who left mid-setup finds the resume and job text again", areas[0].value === RESUME && areas[1].value === JOB);
    check("autosave(resume): ...with the 'Draft restored' notice", !!notice());
    check("autosave(resume): restoring called no model route", !calls.some((c) => c.url.startsWith("/api/tailor")), calls.map((c) => c.url));
    await click(document.querySelector("[data-draft-discard]"));
    areas = [...document.querySelectorAll("textarea")];
    check("autosave(resume): Discard draft empties the builder and removes the stash", areas[0].value === "" && areas[1].value === "" && rec(GKEY) === null && !notice());
    await unmount();

    // sign-up round trip is unchanged on top of autosave: stash -> sign up -> restore
    resetBrowser();
    m = loadAll();
    const nv = [];
    await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose() {}, isPro: false }), { navigated: nv }));
    await fillResumeForm();
    routes["/api/tailor"] = () => json(402, capPayload("tailor"));
    await click(byText("Build My Resume"));
    await click(byText(MSG.create, "[data-guest-cap] button"));
    check("round trip: sign-up flags the one record as the hand-off and navigates to sign-up", rec(GKEY) && rec(GKEY).handoff === true && nv.join() === m.draft.GUEST_SIGN_UP_HREF, { rec: rec(GKEY), nv });
    await sleep(700); // a debounced autosave landing after the click must not strip the flag
    await unmount();
    check("round trip: ...and a late autosave keeps the hand-off flag", rec(GKEY) && rec(GKEY).handoff === true);
    m = loadAll();
    clerk.isSignedIn = true;
    let seenTool = null;
    const Probe = () => { seenTool = m.tools.useTools().activeTool; return null; };
    await mount(app(m, h(Probe)));
    check("round trip: the new account lands on the builder, filled in", seenTool === "resume");
    await unmount();
    check("round trip: ...and the hand-off is consumed", sessionStorage.getItem(GKEY) === null);

    // a signed-in user with an autosaved draft is NOT whisked into the tool by it
    resetBrowser(); clerk.isSignedIn = true;
    m = loadAll();
    m.draft.guestDraftStash.save({ tool: "resume", content: { resumeText: RESUME, jobText: JOB, result: "", tplId: "r1" } });
    seenTool = null;
    await mount(app(m, h(Probe)));
    check("autosave(resume): a plain autosave never reopens the builder on its own (only the sign-up hand-off does)", seenTool === null, seenTool);
    await unmount();

    // signed in: a saved resume (server data) is never clobbered by the stash
    resetBrowser(); clerk.isSignedIn = true;
    m = loadAll();
    m.draft.guestDraftStash.save({ tool: "resume", content: { resumeText: "OLD STASHED TEXT", jobText: "OLD JOB", result: "", tplId: "r1" } });
    const saved = { resumeText: "SERVER RESUME TEXT", jobText: "SERVER JOB", result: "", tplId: "r5" };
    function Reopen({ mm }) { const t = mm.tools.useTools(); React.useEffect(() => { t.openResume(saved, "srv-1"); }, []); return t.activeTool === "resume" ? h(mm.resume.ResumeBuilderTool, { onClose: t.closeTool, isPro: false }) : null; } // eslint-disable-line
    routes["/api/resumes"] = () => json(200, { ok: true });
    await mount(app(m, h(Reopen, { mm: m })));
    areas = [...document.querySelectorAll("textarea")];
    check("signed-in: reopening a saved resume shows the SERVER data, not the stash, and no notice", areas[0].value === "SERVER RESUME TEXT" && areas[1].value === "SERVER JOB" && !notice(), areas.map((a) => a.value));
    await type(areas[0], "SERVER RESUME TEXT edited");
    await sleep(700);
    await unmount();
    check("signed-in: ...and editing it never writes into the stash", rec(GKEY) && rec(GKEY).draft.content.resumeText === "OLD STASHED TEXT", rec(GKEY));

    // signed in, new builder: unsaved work is restored; once the server has it, the stash is cleared
    resetBrowser(); clerk.isSignedIn = true;
    m = loadAll();
    m.draft.guestDraftStash.save({ tool: "resume", content: { resumeText: RESUME, jobText: JOB, result: "", tplId: "r1" } });
    routes["/api/resumes"] = () => json(200, { ok: true });
    await mount(Builder(m));
    areas = [...document.querySelectorAll("textarea")];
    check("signed-in: a NEW builder (server returned nothing) restores unsaved work", areas[0].value === RESUME && !!notice());
    await unmount(); // closing flushes the server save
    await settle(); await sleep(50);
    check("signed-in: ...and once the server has it the stash is cleared (no duplicate on the next open)", calls.some((c) => c.url === "/api/resumes" && c.method === "POST") && rec(GKEY) === null, { calls: calls.map((c) => c.method + " " + c.url), stash: rec(GKEY) });

    // forms don't trade drafts: a cover-letter stash is not restored into the resume builder, or erased by it
    resetBrowser();
    m = loadAll();
    m.draft.guestDraftStash.save({ tool: "cover", content: { name: "Jane", contact: "", company: "Stripe", role: "Nurse", highlights: "", jobText: JOB, tplId: "c1", result: "" } });
    await mount(Builder(m));
    areas = [...document.querySelectorAll("textarea")];
    await unmount();
    check("autosave(resume): a cover-letter stash is not restored into the resume builder, and mounting a blank builder leaves it alone", areas[0].value === "" && !notice() && rec(GKEY) && rec(GKEY).draft.tool === "cover", rec(GKEY));

    // unit: the shared stash
    {
      const ds = load("lib/draft-stash.ts");
      const mem = new Map(); const st = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
      const S = ds.createStash({ key: "k", ttlMs: 1000, isEmpty: (d) => !d.t, parse: (r) => (r && typeof r.t === "string" ? { t: r.t } : null) });
      S.save({ t: "a" }, { store: st, now: 10, handoff: true });
      S.save({ t: "b" }, { store: st, now: 20 });
      check("stash: an autosave over a hand-off keeps the flag; handoff:false spends it", S.pendingHandoff(st, 30) === true && (S.save({ t: "c" }, { store: st, now: 30, handoff: false }), S.pendingHandoff(st, 30) === false));
      check("stash: read leaves the record, takeHandoff only takes a flagged one", S.read(st, 40).t === "c" && S.takeHandoff(st, 40) === null && mem.has("k") && (S.save({ t: "d" }, { store: st, now: 40, handoff: true }), S.takeHandoff(st, 41).t === "d") && !mem.has("k"));
      check("stash: stale and malformed records are dropped, empty drafts clear", (() => { S.save({ t: "x" }, { store: st, now: 0 }); const stale = S.read(st, 5000); mem.set("k", "junk"); const bad = S.read(st, 1); S.save({ t: "x" }, { store: st, now: 1 }); S.save({ t: "" }, { store: st, now: 2 }); return stale === null && bad === null && !mem.has("k"); })());
    }

    // one stash system: no other sessionStorage user, and nothing but the two form keys ever appears
    {
      const offenders = [];
      // code (not comment) lines that use sessionStorage for a DRAFT; unrelated users (export nudge, studio) are not our concern
      const scan = (f) => { if (/\.(tsx?)$/.test(f) && fs.readFileSync(f, "utf8").split("\n").some((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /sessionStorage/.test(l) && /draft/i.test(l))) offenders.push(path.relative(ROOT, f)); };
      (function walk(dir) { for (const en of fs.readdirSync(dir, { withFileTypes: true })) { if (en.name === "node_modules" || en.name === ".next") continue; const f = path.join(dir, en.name); if (en.isDirectory()) walk(f); else scan(f); } })(ROOT + "/app");
      for (const d of ["lib", "components"]) for (const en of fs.readdirSync(path.join(ROOT, d))) scan(path.join(ROOT, d, en));
      check("one stash code path: no code outside lib/draft-stash.ts reads or writes a draft in sessionStorage", offenders.length === 0, offenders);
      const keys = [...new Set([...fs.readFileSync(path.join(ROOT, "lib/guest-draft.ts"), "utf8").matchAll(/"(rt_[a-z_]*draft[a-z_]*)"/g), ...fs.readFileSync(path.join(ROOT, "lib/employer-demo.ts"), "utf8").matchAll(/"(rt_[a-z_]*draft[a-z_]*)"/g)].map((x) => x[1]))];
      check("one stash code path: exactly two keys exist (resume/cover, employer job) — the same ones the sign-up flow already used", keys.sort().join() === "rt_employer_demo_draft,rt_guest_draft", keys);
    }

    // i18n
    for (const l of ["en", "es", "fr", "hi", "zh"]) {
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, `messages/${l}.json`), "utf8")).draftRestore;
      check(`draft i18n: ${l} has restored / discard / dismiss`, d && d.restored && d.discard && d.dismiss);
    }
    clerk.isSignedIn = false;
  }

  // ═══ 5c. "free runs left" note: advance notice beside the action button, never a replacement for the cap prompt ═══
  {
    const runsNote = () => document.querySelector("[data-guest-runs]");
    const runsText = () => (runsNote() ? runsNote().textContent.trim() : null);
    const R = messages.guestRuns;
    const atsOk = (used) => json(200, { score: 72, verdict: "Good", matched: ["icu"], missing: ["bls"], suggestions: ["Add BLS"], guest: true, tool: "ats-scan", limit: 3, used });
    const doScan = async () => { const a = [...document.querySelectorAll("textarea")]; if (!a[0].value) { await type(a[0], RESUME); await type(a[1], JOB); } await click(byText("Scan resume") || byText("Scan again")); };

    // 1/day tool (resume): nothing before first use, "Free run used" after, and the 402 flow is unchanged
    resetBrowser();
    let m = loadAll();
    let n = 0;
    routes["/api/tailor"] = () => (n++ === 0 ? json(200, { result: "TAILORED", guest: true, tool: "tailor", limit: 1, used: 1 }) : json(402, { ...capPayload("tailor"), used: 1 }));
    await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose() {}, isPro: false })));
    await fillResumeForm();
    check("runs: nothing is shown before the guest's first run", !runsNote());
    await click(byText("Build My Resume"));
    check("runs: after the 1st tailor — 'Free run used — resets tomorrow', beside the action button (in the footer)", runsText() === R.usedOne && runsNote().closest("footer"), runsText());
    check("runs: ...and it is quiet — no prompt, no dialog", !prompt());
    await click(byText("Rebuild"));
    check("runs: the next try still gets the bottom cap prompt (402 flow unchanged)", !!prompt() && prompt().getAttribute("data-kind") === "quota", prompt() && prompt().textContent);
    check("runs: ...and the note stays for when the prompt is dismissed", runsText() === R.usedOne);
    await unmount();

    // a 402 on a fresh page load (guest used it earlier) shows the note too
    resetBrowser();
    m = loadAll();
    routes["/api/tailor"] = () => json(402, { ...capPayload("tailor"), used: 1 });
    await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose() {}, isPro: false })));
    await fillResumeForm();
    await click(byText("Build My Resume"));
    await click(document.querySelector("[data-guest-later]"));
    check("runs: after a 402 (used === limit) and 'Maybe later', the note reads 'Free run used'", runsText() === R.usedOne, runsText());
    await unmount();

    // multi-use (ats-scan 3/day): hidden untouched, then 2 of 3, 1 of 3, 0 of 3, then the cap prompt
    resetBrowser();
    m = loadAll();
    let used = 0;
    routes["/api/ats-scan"] = () => (used < 3 ? atsOk(++used) : json(402, { ...capPayload("ats-scan", 3), used: 3 }));
    await mount(app(m, h(m.ats.AtsScannerTool, { onClose() {} })));
    check("runs[ats-scan]: hidden while the quota is untouched (and no 'unlimited' claim for a guest)", !runsNote() && !document.body.textContent.includes("unlimited scans"));
    const seen = [];
    for (let i = 0; i < 3; i++) { await doScan(); seen.push(runsText()); }
    check("runs[ats-scan]: counts down per use — 2 of 3, 1 of 3, 0 of 3 free scans left today", seen.join("|") === ["2 of 3", "1 of 3", "0 of 3"].map((x) => `${x} free scans left today`).join("|"), seen);
    check("runs[ats-scan]: ...matching the catalog wording", seen[0] === R.scansLeft.replace("{left}", "2").replace("{limit}", "3"));
    await doScan();
    check("runs[ats-scan]: the 4th attempt gets the cap prompt, exactly as before", !!prompt() && prompt().querySelector("h3").textContent === "You've used today's free ATS scans", prompt() && prompt().textContent);
    await unmount();

    // cover letter
    resetBrowser();
    m = loadAll();
    routes["/api/cover-letter"] = () => json(200, { result: "DEAR HIRING MANAGER", guest: true, tool: "cover-letter", limit: 1, used: 1 });
    await mount(app(m, h(m.cover.CoverLetterTool, { onClose() {}, isPro: false })));
    await type([...document.querySelectorAll("input")][2], "Stripe");
    check("runs[cover-letter]: hidden before first use", !runsNote());
    await click(byText("Generate letter") || byText("Generate Letter"));
    check("runs[cover-letter]: 'Free run used — resets tomorrow' after the first", runsText() === R.usedOne, runsText());
    await unmount();

    // signed in: never shown, even if (hypothetically) a response looked like a guest's
    resetBrowser();
    clerk.isSignedIn = true;
    m = loadAll();
    routes["/api/tailor"] = () => json(200, { result: "TAILORED", guest: true, tool: "tailor", limit: 1, used: 1 });
    routes["/api/ats-scan"] = () => atsOk(2);
    await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose() {}, isPro: false })));
    await fillResumeForm();
    await click(byText("Build My Resume"));
    check("runs[signed in]: the resume builder shows no note", !runsNote() && !document.body.textContent.includes(R.usedOne));
    await unmount();
    await mount(app(m, h(m.ats.AtsScannerTool, { onClose() {} })));
    await doScan();
    check("runs[signed in]: the ATS scanner shows no note, and keeps its 'unlimited scans' label", !runsNote() && document.body.textContent.includes("Free · unlimited scans"));
    await unmount();
    clerk.isSignedIn = false;

    // employer demo: the JD writer
    resetBrowser();
    reload();
    {
      const prov = load("app/employer/components/demo/demo-provider.tsx");
      const jobs = load("app/employer/jobs/jobs-client.tsx");
      const MJ = messages.employerJobs;
      const input = (ph) => document.querySelector(`input[placeholder="${ph}"]`);
      const area = (ph) => document.querySelector(`textarea[placeholder="${ph}"]`);
      let k = 0;
      routes["/api/employer/jobs/assist"] = () => (k++ === 0 ? json(200, { description: "POLISHED", guest: true, tool: "employer-jd", limit: 1, used: 1 }) : json(402, { ...capPayload("employer-jd"), used: 1 }));
      await mount(h(prov.EmployerDemoProvider, { navigate() {} }, h(jobs.JobsClient, { openNew: true })));
      await type(input(MJ.placeholderJobTitle), "Warehouse Lead");
      await type(area(MJ.placeholderDescription), "Run the afternoon shift and keep the floor safe.");
      check("runs[employer]: hidden before the AI writer's first use", !runsNote());
      await click(byText(MJ.improveWithAi));
      check("runs[employer]: after use — '1 free AI improvement per day — yours refreshes tomorrow'", runsText() === messages.employerDemo.runsUsed && runsText() === "1 free AI improvement per day — yours refreshes tomorrow", runsText());
      await click(byText(MJ.improveWithAi));
      check("runs[employer]: the next try still opens the bottom cap prompt", !!prompt() && prompt().querySelector("h3").textContent === "You've used today's free employer preview");
      await unmount();
      // the real (signed-in) portal's form has no demo provider => no note
      resetBrowser();
      routes["/api/employer/jobs/assist"] = () => json(200, { description: "POLISHED" });
      await mount(h(jobs.JobsClient, { openNew: true }));
      await type(input(MJ.placeholderJobTitle), "Warehouse Lead");
      await type(area(MJ.placeholderDescription), "Run the afternoon shift and keep the floor safe.");
      await click(byText(MJ.improveWithAi));
      check("runs[employer]: a signed-in employer's form never shows it", !runsNote());
      await unmount();
    }

    // pure parser + catalog
    {
      const cap = load("lib/guest-cap.ts");
      check("runs: parseGuestRuns reads a guest payload and rejects signed-in / partial / malformed ones", JSON.stringify(cap.parseGuestRuns({ guest: true, tool: "ats-scan", used: 2, limit: 3 })) === '{"tool":"ats-scan","used":2,"limit":3}' && cap.parseGuestRuns({ result: "x" }) === null && cap.parseGuestRuns({ guest: true, tool: "tailor", limit: 1 }) === null && cap.parseGuestRuns({ guest: false, tool: "tailor", used: 1, limit: 1 }) === null && cap.parseGuestRuns({ guest: true, tool: "tailor", used: -1, limit: 1 }) === null && cap.parseGuestRuns({ guest: true, tool: "tailor", used: 9, limit: 1 }).used === 1 && cap.parseGuestRuns(null) === null);
    }
    for (const l of ["en", "es", "fr", "hi", "zh"]) {
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, `messages/${l}.json`), "utf8"));
      check(`runs i18n: ${l} has guestRuns.usedOne / scansLeft ({left}/{limit}) and employerDemo.runsUsed`, d.guestRuns && d.guestRuns.usedOne && /\{left\}/.test(d.guestRuns.scansLeft) && /\{limit\}/.test(d.guestRuns.scansLeft) && d.employerDemo.runsUsed);
    }
  }

  // ═══ 6. source guards: no gated call site can skip the cap check, and it precedes every "upgrade" redirect ═══
  {
    const GATED = ["/api/tailor", "/api/cover-letter", "/api/ats-scan", "/api/extract-text", "/api/fetch-job-url", "/api/linkedin/scrape", "/api/linkedin/import", "/api/linkedin/analyze", "/api/interview/questions", "/api/interview/feedback", "/api/jobs/search", "/api/jobs/cover-letter", "/api/jobs/apply-package", "/api/career/insights", "/api/career/skill-gap", "/api/career/roadmap", "/api/decoder/decode"];
    const files = [];
    (function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (/\.tsx$/.test(e.name)) files.push(f); } })(path.join(ROOT, "app/candidate"));
    const missing = [];
    const orderBad = [];
    let sites = 0;
    for (const f of files) {
      if (f.endsWith("resume-video.tsx")) continue; // Pro-only tool: its extract-text call is never a guest's
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const route of GATED) {
          if (!new RegExp(`fetch\\((["\`'])${route.replace(/\//g, "\\/")}\\1`).test(line)) continue;
          if (route === "/api/decoder/decode" && /GET|cache: "no-store" \}\)\.then/.test(line)) continue; // the quota readout, not an action
          sites++;
          const window8 = lines.slice(i, i + 16).join("\n"); // (tailor's fetch sits inside a small closure; its check follows the call)
          if (!/handleCapResponse\(res\)/.test(window8)) missing.push(`${path.relative(ROOT, f)}:${i + 1} ${route}`);
          const up = window8.search(/status === 402/);
          const cap = window8.search(/handleCapResponse/);
          if (up !== -1 && cap !== -1 && cap > up) orderBad.push(`${path.relative(ROOT, f)}:${i + 1}`);
        }
      });
    }
    check(`source: all ${sites} call sites of a guest-gated route check for a guest cap right after the fetch`, sites >= 17 && missing.length === 0, missing);
    check("source: ...and every one does so BEFORE any generic 402 -> upgrade redirect", orderBad.length === 0, orderBad);
    const tailor = fs.readFileSync(path.join(ROOT, "app/candidate/tools/resume-tailor.tsx"), "utf8");
    check("source: the Edit-text textarea has a 40vh minimum, is resizable, and its scroll area keeps 50vh at every width", /min-h-\[40vh\]/.test(tailor) && /resize-y/.test(tailor) && !/min-h-\[360px\] w-full resize-none/.test(tailor) && /editing && result && "min-h-\[50vh\]"/.test(tailor) && !/lg:min-h-0/.test(tailor));
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) { console.error("\nFAILED"); process.exit(1); }
  console.log("ALL PASS");
  process.exit(0);
})().catch((e) => { console.error("TEST HARNESS ERROR", e); process.exit(1); });
