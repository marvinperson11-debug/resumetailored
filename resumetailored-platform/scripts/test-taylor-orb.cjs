#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS test script, matches scripts/test-employer-assistant.cjs */
/**
 * TaylorOrb (npm run test:taylor-orb) — Taylor's living gold orb, Phase 1
 * (components/assistant/TaylorOrb/). This repo has no jest/vitest and no
 * .test.tsx convention (confirmed by grep before writing this file); every
 * other feature's tests are a plain .cjs script run directly with `node`,
 * several of which (scripts/test-employer-assistant.cjs) already render
 * real .tsx components through a hand-rolled ts.transpileModule require
 * hook + JSDOM + react-dom/client. This file reuses that exact technique
 * rather than introducing a new test framework for one component.
 *
 * Covers: exact token values (colours/sizes/timings), all five states being
 * programmatically distinguishable, the props contract (default sizes per
 * placement, explicit size override), the reduced-motion fallback actually
 * flipping a visible attribute, the "no silent failure" console logging
 * when a 2D canvas context is unavailable (the real condition in THIS
 * JSDOM, since the optional `canvas` npm package isn't installed here —
 * not a simulated one), and a source-level grep for forbidden APIs/markup
 * (audio, emoji, waitlist/number badges) across every file this build
 * touched.
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

const transpile = (mod, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  });
  mod._compile(out.outputText, filename);
};
require.extensions[".ts"] = transpile;
require.extensions[".tsx"] = transpile;

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = path.join(ROOT, request.slice(2));
    for (const cand of [base + ".ts", base + ".tsx", path.join(base, "index.ts"), base]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    }
  }
  return origResolve.call(this, request, parent, ...rest);
};

const load = (rel) => require(path.join(ROOT, rel));

(async () => {
  // ═══ 1. tokens.ts — exact values, pixel-level spec ═══
  const tokens = load("components/assistant/TaylorOrb/tokens.ts");
  check("TAYLOR_ORB_COLORS.core is Taylor's existing gold accent (tailwind `violet`)", tokens.TAYLOR_ORB_COLORS.core === "#C2870B", tokens.TAYLOR_ORB_COLORS);
  check("TAYLOR_ORB_COLORS.highlight is the documented 15%-lighter value", tokens.TAYLOR_ORB_COLORS.highlight === "#CB9930", tokens.TAYLOR_ORB_COLORS);
  check("TAYLOR_ORB_COLORS.shadow is the documented 20%-darker value", tokens.TAYLOR_ORB_COLORS.shadow === "#9B6C09", tokens.TAYLOR_ORB_COLORS);
  check("TAYLOR_ORB_COLORS.glow is core at 40% opacity", tokens.TAYLOR_ORB_COLORS.glow === "rgba(194, 135, 11, 0.4)", tokens.TAYLOR_ORB_COLORS);

  check("TAYLOR_ORB_SIZES.header default is 24px", tokens.TAYLOR_ORB_SIZES.header === 24);
  check("TAYLOR_ORB_SIZES.messageAvatar default is 32px", tokens.TAYLOR_ORB_SIZES.messageAvatar === 32);

  check("TAYLOR_ORB_TIMINGS matches the pixel-level spec exactly", JSON.stringify(tokens.TAYLOR_ORB_TIMINGS) === JSON.stringify({
    idle: 4000, listening: 2000, speaking: 800, thinking: 2400, hasUpdatePulse: 3000, transition: 300,
  }), tokens.TAYLOR_ORB_TIMINGS);

  const states = ["idle", "listening", "speaking", "thinking", "has-update"];
  const paramSets = states.map((s) => tokens.getOrbMotionParams(s));
  check("getOrbMotionParams returns a record for all five states", paramSets.every((p) => p && typeof p.period === "number"), paramSets);
  let allDistinct = true;
  for (let i = 0; i < paramSets.length; i++) {
    for (let j = i + 1; j < paramSets.length; j++) {
      if (JSON.stringify(paramSets[i]) === JSON.stringify(paramSets[j])) allDistinct = false;
    }
  }
  check("every state's motion params are distinguishable from every other state's", allDistinct, paramSets);
  check("speaking is the only state with the peak-mid amplitude envelope", states.filter((s) => tokens.getOrbMotionParams(s).envelope === "peak-mid").length === 1 && tokens.getOrbMotionParams("speaking").envelope === "peak-mid");
  check("only has-update carries a pulsePeriod", states.filter((s) => tokens.getOrbMotionParams(s).pulsePeriod !== null).length === 1 && tokens.getOrbMotionParams("has-update").pulsePeriod === tokens.TAYLOR_ORB_TIMINGS.hasUpdatePulse);
  check("thinking is the only state with a non-zero rotationSpeed and bob", tokens.getOrbMotionParams("thinking").rotationSpeed > 0 && tokens.getOrbMotionParams("thinking").bobPx > 0);

  // ═══ 2. Source-level grep — forbidden APIs/markup across every touched file ═══
  const touchedFiles = [
    "components/assistant/TaylorOrb/TaylorOrb.tsx",
    "components/assistant/TaylorOrb/tokens.ts",
    "components/assistant/TaylorOrb/index.ts",
    "components/assistant/useVoiceOutput.ts",
    "components/assistant/VoiceSettingsPopover.tsx",
    "components/assistant/PendingActionsInbox.tsx",
    "app/employer/assistant/assistant-client.tsx",
  ];
  const orbSrc = fs.readFileSync(path.join(ROOT, "components/assistant/TaylorOrb/TaylorOrb.tsx"), "utf8");
  check("TaylorOrb.tsx never constructs an AudioContext", !/AudioContext/.test(orbSrc));
  check("TaylorOrb.tsx never renders an <audio> element", !/<audio/i.test(orbSrc));
  check("TaylorOrb.tsx never touches speechSynthesis or SpeechSynthesisUtterance", !/speechSynthesis|SpeechSynthesisUtterance/.test(orbSrc));
  check("TaylorOrb.tsx renders no waitlist or numeric badge markup", !/badge|waitlist/i.test(orbSrc));
  // eslint-disable-next-line no-control-regex
  const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (const rel of touchedFiles) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    check(`${rel}: no emoji characters`, !EMOJI_RE.test(src));
  }

  // ═══ 3. Component contract, rendered through real React + JSDOM ═══
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "https://app.resumetailored.com" });
  const { window } = dom;
  for (const k of ["window", "document", "navigator", "HTMLElement", "Event"]) {
    try { Object.defineProperty(globalThis, k, { value: k === "window" ? window : window[k], configurable: true, writable: true }); } catch { /* read-only on this Node */ }
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const errorLog = [];
  const origConsoleError = console.error;
  console.error = (...args) => { errorLog.push(args); origConsoleError(...args); };

  const React = require("react");
  const { createRoot } = require("react-dom/client");
  delete require.cache[require.resolve(path.join(ROOT, "components/assistant/TaylorOrb/TaylorOrb.tsx"))];
  const { TaylorOrb } = load("components/assistant/TaylorOrb/TaylorOrb.tsx");
  const { act } = React;

  const container = window.document.getElementById("root");
  const root = createRoot(container);

  for (const state of states) {
    await act(async () => {
      root.render(React.createElement(TaylorOrb, { state, placement: "header" }));
    });
    const el = container.querySelector("[data-taylor-orb]");
    check(`header orb[${state}]: data-state reflects the prop`, el?.getAttribute("data-state") === state);
    check(`header orb[${state}]: role=img with a non-empty aria-label`, el?.getAttribute("role") === "img" && !!el?.getAttribute("aria-label"));
    check(`header orb[${state}]: aria-label has no emoji`, !EMOJI_RE.test(el?.getAttribute("aria-label") || ""));
    check(`header orb[${state}]: renders a canvas`, !!el?.querySelector("canvas"));
  }

  check("no-silent-failure: a null 2D context (this JSDOM's real condition — no `canvas` npm package installed) logs via console.error rather than failing silently", errorLog.some((args) => args[0] === "[TaylorOrb] 2D canvas context unavailable; rendering nothing for this frame"), errorLog);

  await act(async () => {
    root.render(React.createElement(TaylorOrb, { state: "idle", placement: "header" }));
  });
  check("header placement default size is 24px (TAYLOR_ORB_SIZES.header)", container.querySelector("[data-taylor-orb]").style.width === "24px");

  await act(async () => {
    root.render(React.createElement(TaylorOrb, { state: "idle", placement: "message-avatar" }));
  });
  check("message-avatar placement default size is 32px (TAYLOR_ORB_SIZES.messageAvatar)", container.querySelector("[data-taylor-orb]").style.width === "32px");

  await act(async () => {
    root.render(React.createElement(TaylorOrb, { state: "idle", placement: "header", size: 16 }));
  });
  check("an explicit size prop overrides the placement default (matches the real 16px header slot in this codebase)", container.querySelector("[data-taylor-orb]").style.width === "16px");

  await act(async () => {
    root.render(React.createElement(TaylorOrb, { state: "idle", placement: "message-avatar", "aria-label": "Taylor" }));
  });
  check("an explicit aria-label overrides the default label", container.querySelector("[data-taylor-orb]").getAttribute("aria-label") === "Taylor");

  // ═══ 4. Reduced-motion fallback actually renders, and is distinguishable from animated motion ═══
  // `detectReducedMotion()` only runs once, on mount — swapping
  // window.matchMedia on an already-mounted instance (as opposed to firing
  // a real 'change' event on the MediaQueryList it already subscribed to,
  // which this harness doesn't model) has no effect, same as a real
  // browser. So: unmount, swap, mount fresh.
  await act(async () => root.unmount());
  const realMatchMedia = window.matchMedia;
  window.matchMedia = (query) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} });
  const root2 = createRoot(container);
  await act(async () => {
    root2.render(React.createElement(TaylorOrb, { state: "idle", placement: "header" }));
  });
  check("prefers-reduced-motion: true renders data-reduced-motion=\"true\"", container.querySelector("[data-taylor-orb]").getAttribute("data-reduced-motion") === "true");
  window.matchMedia = realMatchMedia;

  await act(async () => root2.unmount());
  console.error = origConsoleError;

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) {
    console.error("FAILURES DETECTED");
    process.exit(1);
  }
  console.log("ALL PASS");
})();
