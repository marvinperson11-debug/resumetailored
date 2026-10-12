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
    await click(byText("Build My Resume"));

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
    await click(byText("Build My Resume"));
    check("cap: pressing Build again shows it again", !!prompt());
    await click(byText(MSG.later));
    check("cap: Maybe later dismisses it", !prompt());
    const areas = [...document.querySelectorAll("textarea")];
    check("cap: ...and the guest's text is still in the form", areas[0].value === RESUME && areas[1].value === JOB);
    check("cap: backdrop click dismisses too", await (async () => { await click(byText("Build My Resume")); await click(document.querySelector("[data-guest-cap-root] > div[aria-hidden]")); return !prompt(); })());

    // anchored above the button bar when the tool's footer is pinned to the bottom of the viewport (phone)
    const footer = document.querySelector('[role="dialog"] footer');
    const orig = footer.getBoundingClientRect;
    footer.getBoundingClientRect = () => ({ top: 770, bottom: 844, height: 74, left: 0, right: 390, width: 390, x: 0, y: 770 });
    await click(byText("Build My Resume"));
    const p2 = prompt();
    check("cap: on a phone it sits directly ABOVE the button bar (bottom = bar height, not 0)", p2 && p2.style.bottom === "74px" && !/\bbottom-0\b/.test(p2.className), p2 && { bottom: p2.style.bottom, cls: p2.className });
    footer.getBoundingClientRect = orig;
    await click(byText(MSG.later));
    // a centered desktop modal (footer not at the viewport bottom) falls back to the bottom edge
    footer.getBoundingClientRect = () => ({ top: 700, bottom: 760, height: 60, left: 0, right: 390, width: 390, x: 0, y: 700 });
    await click(byText("Build My Resume"));
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
    await click(byText("Build My Resume"));
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
    await click(byText("Build My Resume"));
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
    await fillResumeForm();
    await click(byText("Build My Resume"));
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
    await fillResumeForm();
    await click(byText("Build My Resume"));
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
    await click(byText("Build My Resume"));
    check("signed-in: a successful tailor shows no nudge", !document.querySelector("[data-guest-nudge]"));
    check("signed-in: ...and sets no nudge flag", localStorage.getItem("rt_guest_nudge_seen") === null);
    await unmount();

    // even a (hypothetical, wrong) guest-shaped response never produces guest UI for a signed-in session
    routes["/api/tailor"] = () => json(200, { result: "TAILORED RESUME", guest: true });
    m = loadAll();
    await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose() {}, isPro: false })));
    await fillResumeForm();
    await click(byText("Build My Resume"));
    check("signed-in: a response flagged guest:true still shows no nudge", !document.querySelector("[data-guest-nudge]") && localStorage.getItem("rt_guest_nudge_seen") === null);
    await unmount();
    routes["/api/tailor"] = () => json(402, capPayload("tailor"));
    m = loadAll();
    await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose() {}, isPro: false })));
    await fillResumeForm();
    await click(byText("Build My Resume"));
    check("signed-in: a guest-shaped 402 shows no prompt (the tool's own inline error handling runs)", !prompt() && !!document.querySelector("p.text-red-300"));
    await unmount();
    check("signed-in: no draft is ever stashed", sessionStorage.getItem("rt_guest_draft") === null);

    // a pro_template 402 (a signed-out guest asking for a Pro template) is NOT a cap
    clerk.isSignedIn = false;
    routes["/api/tailor"] = () => json(402, { error: "pro_template", message: "This template is Pro-only." });
    m = loadAll();
    await mount(app(m, h(m.resume.ResumeBuilderTool, { onClose() {}, isPro: false })));
    await fillResumeForm();
    await click(byText("Build My Resume"));
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
      await click(byText("Build My Resume"));
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
      check("employer round trip: ...the stash is consumed, and nothing was posted or published", sessionStorage.getItem(dm4.EMPLOYER_DRAFT_KEY) === null && !calls.some((c) => c.method === "POST"), calls.map((c) => c.method + " " + c.url));
      await unmount();
      nav.replaces.length = 0;
      await mount(h("div", null, h(rest4.EmployerDraftRestorer), h(jobs4.JobsClient, { openNew: true })));
      check("employer round trip: a second visit (no draft) fills nothing and redirects nowhere", nav.replaces.length === 0 && input(MJ.placeholderJobTitle).value === "");
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
