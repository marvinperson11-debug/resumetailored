#!/usr/bin/env node
/**
 * The LockedFeature gate (npm run test:locked-feature) — the real component
 * (components/locked-feature.tsx) rendered into a jsdom DOM with React 18, next-intl
 * backed by the real messages/en.json (a missing key fails the test instead of
 * rendering as a key name), exactly like the other component-test scripts in this
 * repo (see test-guest-nudge.cjs for the shared conventions this one reuses).
 *
 *   - variant "employer" renders BOTH the paid Portal CTA (/employer-checkout?plan=portal)
 *     and the secondary free-claim link (/employer-checkout?plan=free), with the free
 *     link appearing after the paid one (paid stays primary) and never navigating away
 *     from the rendering (<a>/<Link>, no onClick side effect).
 *   - variant "pro" is untouched: no free-claim link, no employer wording, still the
 *     Pro-upgrade CTA pointing at /candidate?upgrade=pro.
 *   - i18n: every locale (en, es, fr, hi, zh) has the new `lockedFeature.claimFree` key.
 *   - the claim-free route itself (app/api/employer/claim-free/route.ts) is untouched by
 *     this change — a source-level sanity check, since this script renders UI only and
 *     never calls the route.
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
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "https://app.resumetailored.com/employer", pretendToBeVisual: true });
const { window } = dom;
for (const k of ["window", "document", "navigator", "HTMLElement", "Event", "getComputedStyle", "Node"]) {
  try { Object.defineProperty(globalThis, k, { value: k === "window" ? window : window[k], configurable: true, writable: true }); } catch { /* read-only on this Node */ }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ── module hooks: TS/TSX, "@/" alias, and the two outside things (next-intl, next/link) ──
const messages = JSON.parse(fs.readFileSync(path.join(ROOT, "messages/en.json"), "utf8"));
const lookup = (ns, key) => `${ns}.${key}`.split(".").reduce((o, k) => (o == null ? o : o[k]), messages);
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
};
const React = require("react");
const h = React.createElement;
const mocks = {
  "next-intl": () => intl,
  "next/link": () => ({ __esModule: true, default: ({ href, children, ...rest }) => h("a", { href, ...rest }, children) }),
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

const { createRoot } = require("react-dom/client");
const { act } = React;

function reload() {
  for (const k of Object.keys(require.cache)) if (k.startsWith(ROOT) && !k.includes("node_modules")) delete require.cache[k];
}

let root = null;
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
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
const links = () => [...document.querySelectorAll("a")];

(async () => {
  // ═══ 1. variant "employer" — both options, correct hrefs, paid stays primary ═══
  {
    reload();
    const { LockedFeature } = require(path.join(ROOT, "components/locked-feature.tsx"));
    await mount(h(LockedFeature, { feature: "Employer Portal", variant: "employer" }));

    const as = links();
    const paid = as.find((a) => a.getAttribute("href") === "/employer-checkout?plan=portal");
    const free = as.find((a) => a.getAttribute("href") === "/employer-checkout?plan=free");
    check("employer: renders the paid Portal CTA at the right href", !!paid, as.map((a) => a.getAttribute("href")));
    check("employer: renders the free-claim link at the right href", !!free, as.map((a) => a.getAttribute("href")));
    check("employer: the free-claim label matches the catalog copy (1 job, 10 candidates, 1 seat)", free && free.textContent.trim() === messages.lockedFeature.claimFree, free && free.textContent);
    check("employer: exactly two links on the gate (no stray third CTA)", as.length === 2, as.map((a) => a.getAttribute("href")));
    check("employer: the paid CTA appears before the free one in DOM order (stays primary)", as.indexOf(paid) < as.indexOf(free));
    check("employer: the paid CTA keeps its prior label + billed-separately note", document.body.textContent.includes(messages.lockedFeature.learnEmployer) && document.body.textContent.includes(messages.lockedFeature.billedSeparately));
    check("employer: the employerRequired message is still shown", document.body.textContent.includes(messages.lockedFeature.employerRequired));
    check("employer: no Pro-upgrade CTA leaks into this variant", !document.body.textContent.includes(messages.lockedFeature.proRequired) && !as.some((a) => a.getAttribute("href") === "/candidate?upgrade=pro"));
    await unmount();
  }

  // ═══ 2. variant "pro" — unchanged ═══
  {
    reload();
    const { LockedFeature } = require(path.join(ROOT, "components/locked-feature.tsx"));
    await mount(h(LockedFeature, { feature: "Resume Video", variant: "pro" }));

    const as = links();
    check("pro: exactly one CTA, the Pro-upgrade link, unchanged", as.length === 1 && as[0].getAttribute("href") === "/candidate?upgrade=pro", as.map((a) => a.getAttribute("href")));
    check("pro: no employer wording and no free-claim link leaked in", !document.body.textContent.includes(messages.lockedFeature.employerRequired) && !document.body.textContent.includes(messages.lockedFeature.claimFree));
    check("pro: the proRequired message is shown", document.body.textContent.includes(messages.lockedFeature.proRequired));
    await unmount();
  }

  // ═══ 3. i18n: every locale has the new key, non-empty, distinct from the others in the namespace ═══
  {
    for (const l of ["en", "es", "fr", "hi", "zh"]) {
      const m = JSON.parse(fs.readFileSync(path.join(ROOT, `messages/${l}.json`), "utf8")).lockedFeature;
      check(`i18n: ${l} has lockedFeature.claimFree (non-empty string)`, m && typeof m.claimFree === "string" && m.claimFree.trim().length > 0, m && m.claimFree);
    }
  }

  // ═══ 3b. variant "assistant" (Voice Fix Round 2, Section F) — a single CTA at the tier that actually
  // unlocks it (Portal), the two-tier message, and NO free-claim link (unlike "employer": a Free-tier
  // employer hitting this gate is already on the free tier, so there is nothing further to "claim") ═══
  {
    reload();
    const { LockedFeature } = require(path.join(ROOT, "components/locked-feature.tsx"));
    await mount(h(LockedFeature, { feature: "Assistant", variant: "assistant" }));

    const as = links();
    check("assistant: exactly one CTA, pointing at the Portal checkout", as.length === 1 && as[0].getAttribute("href") === "/employer-checkout?plan=portal", as.map((a) => a.getAttribute("href")));
    check("assistant: no free-claim link leaks in (this employer is already on Free)", !as.some((a) => a.getAttribute("href") === "/employer-checkout?plan=free"));
    check("assistant: shows the two-tier assistantRequired message", document.body.textContent.includes(messages.lockedFeature.assistantRequired), document.body.textContent);
    check("assistant: the CTA label is upgradeToPortal, not the employer variant's learnEmployer label", document.body.textContent.includes(messages.lockedFeature.upgradeToPortal) && !document.body.textContent.includes(messages.lockedFeature.learnEmployer));
    check("assistant: no Pro-upgrade wording leaks into this variant", !document.body.textContent.includes(messages.lockedFeature.proRequired));
    await unmount();
  }

  // ═══ 3c. i18n: every locale has the two new "assistant" variant keys, non-empty ═══
  {
    for (const l of ["en", "es", "fr", "hi", "zh"]) {
      const m = JSON.parse(fs.readFileSync(path.join(ROOT, `messages/${l}.json`), "utf8")).lockedFeature;
      check(`i18n: ${l} has lockedFeature.assistantRequired (non-empty string)`, m && typeof m.assistantRequired === "string" && m.assistantRequired.trim().length > 0, m && m.assistantRequired);
      check(`i18n: ${l} has lockedFeature.upgradeToPortal (non-empty string)`, m && typeof m.upgradeToPortal === "string" && m.upgradeToPortal.trim().length > 0, m && m.upgradeToPortal);
    }
  }

  // ═══ 4. the free-claim route's CLAIM LOGIC is untouched by this change ═══
  // Narrowed 2026-10-25: the original check here demanded a byte-for-byte
  // zero diff on the route file, which was right for the LockedFeature UI
  // change this script was written for (a UI-only change has no business
  // touching the route at all) but would also reject any later, legitimate
  // change to the file — e.g. the GA4 free-claim funnel build, which
  // additively instruments this route with fire-and-forget observer calls
  // (trackFreeClaimStarted/trackFreeClaimCompleted, lib/ga4-events.ts) that
  // cannot affect the response or its latency budget. The checkout page
  // keeps the original, stricter zero-diff bar (nothing here should ever
  // need to touch it); the route is checked by asserting its real decision
  // points are still present instead, which is what "claim logic unchanged"
  // actually means.
  {
    const checkoutDiff = require("child_process").execSync(
      "git diff --name-only HEAD -- app/employer-checkout/page.tsx",
      { cwd: ROOT, encoding: "utf8" }
    ).trim();
    check("claim-free: the checkout page is untouched by this change", checkoutDiff === "", checkoutDiff);

    const routeSrc = fs.readFileSync(path.join(ROOT, "app/api/employer/claim-free/route.ts"), "utf8");
    check("claim-free: the admin guard is still present", routeSrc.includes("access.isAdmin") && routeSrc.includes('"admin_cannot_claim"'));
    check("claim-free: the already-employer no-op is still present", routeSrc.includes('access.plan === "employer"') && routeSrc.includes("alreadyEmployer: true"));
    check("claim-free: the confirm-required switch gate is still present", routeSrc.includes("body.confirm !== true") && routeSrc.includes('"confirm_required"'));
    check(
      "claim-free: the metadata write still sets plan/type/tier exactly as before",
      /plan:\s*"employer"[\s\S]*?type:\s*"organization"[\s\S]*?tier:\s*"free"/.test(routeSrc)
    );
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
