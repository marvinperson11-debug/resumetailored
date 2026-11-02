#!/usr/bin/env node
/**
 * Unit tests for components/assistant/voice-settings-position.ts — the pure
 * flip+shift+clamp math behind the VoiceSettingsPopover positioning fix
 * (Round 3). Not wired into package.json per the scope of that fix (no
 * edits outside the voice settings panel and its positioning helpers);
 * run directly with `node scripts/test-voice-settings-position.cjs`.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");

require.extensions[".ts"] = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  module._compile(out.outputText, filename);
};

const {
  MOBILE_SHEET_BREAKPOINT,
  PANEL_GUTTER,
  isMobileSheetWidth,
  computePopoverPosition,
} = require(path.join(ROOT, "components/assistant/voice-settings-position.ts"));

let failures = 0;
let passes = 0;
const check = (name, ok, detail) => {
  if (ok) { passes++; console.log("PASS ", name); }
  else { failures++; console.error("FAIL ", name, detail !== undefined ? "— " + JSON.stringify(detail) : ""); }
};

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });

// ── breakpoint: required widths 320, 375, 479, 480, 481, 768, 1024 ─────────
check("breakpoint const is 480", MOBILE_SHEET_BREAKPOINT === 480);
for (const w of [320, 375, 479, 480]) {
  check(`isMobileSheetWidth(${w}) === true`, isMobileSheetWidth(w) === true);
}
for (const w of [481, 768, 1024]) {
  check(`isMobileSheetWidth(${w}) === false`, isMobileSheetWidth(w) === false);
}

// ── the Round 2 bug itself: trigger flush-left on a narrow viewport ───────
// (what PageHeader's `flex-wrap justify-between` produces when the header
// wraps: a lone action item renders at the main-start edge, i.e. the LEFT.)
for (const vw of [481, 500, 600, 768, 1024, 1280]) {
  const trigger = rect(16, 60, 36, 36); // flush-left, as the wrapped header produces
  const pos = computePopoverPosition(trigger, 288, 220, vw, 800, PANEL_GUTTER);
  check(
    `viewport ${vw}: left-anchored trigger never pushes panel left of the gutter`,
    pos.left >= PANEL_GUTTER,
    pos,
  );
  check(
    `viewport ${vw}: left-anchored trigger never pushes panel past the right gutter`,
    pos.left + pos.maxWidth <= vw - PANEL_GUTTER,
    pos,
  );
}

// ── right-flush trigger (the "it always worked in the test browser" case) ─
{
  const vw = 1024;
  const trigger = rect(vw - 52, 60, 36, 36); // flush-right, 16px page padding
  const pos = computePopoverPosition(trigger, 288, 220, vw, 800, PANEL_GUTTER);
  check("right-flush trigger: panel still fully on-screen", pos.left >= PANEL_GUTTER && pos.left + pos.maxWidth <= vw - PANEL_GUTTER, pos);
  check("right-flush trigger: right edges roughly align (today's visual default)", Math.abs(pos.left + pos.maxWidth - trigger.right) <= 1, pos);
}

// ── vertical flip: trigger near the bottom of a short viewport ────────────
{
  const vh = 400;
  const trigger = rect(100, vh - 50, 36, 36); // near the bottom edge
  const pos = computePopoverPosition(trigger, 288, 220, 1024, vh, PANEL_GUTTER);
  check("flips upward when it would clip the bottom", pos.placement === "top", pos);
  check("flipped-up panel stays within the top gutter", pos.top >= PANEL_GUTTER, pos);
  check("flipped-up panel stays within the bottom gutter", pos.top + pos.maxHeight <= vh - PANEL_GUTTER, pos);
}

// ── vertical: trigger near the top, plenty of room below ──────────────────
{
  const trigger = rect(100, 10, 36, 36);
  const pos = computePopoverPosition(trigger, 288, 220, 1024, 800, PANEL_GUTTER);
  check("stays below the trigger when there's room", pos.placement === "bottom", pos);
}

// ── degenerate: panel taller/wider than the whole viewport still clamps ───
{
  const vw = 320;
  const vh = 480; // exactly at the boundary per the required test matrix
  const trigger = rect(0, 0, 36, 36);
  const pos = computePopoverPosition(trigger, 600, 900, vw, vh, PANEL_GUTTER);
  check("oversized panel width is capped to the viewport minus gutters", pos.maxWidth <= vw - PANEL_GUTTER * 2, pos);
  check("oversized panel height is capped to the viewport minus gutters", pos.maxHeight <= vh - PANEL_GUTTER * 2, pos);
  check("oversized panel left never negative", pos.left >= 0, pos);
  check("oversized panel top never negative", pos.top >= 0, pos);
}

// ── exhaustive sweep across the full required width matrix + a range of
//    trigger positions — the hard invariant must hold everywhere, not just
//    in the hand-picked cases above ──────────────────────────────────────
{
  let sweepOk = true;
  const widths = [320, 375, 390, 414, 479, 480, 481, 768, 810, 834, 1024, 1280];
  const heights = [480, 568, 667, 736, 800, 900, 1024];
  for (const vw of widths) {
    if (isMobileSheetWidth(vw)) continue; // sheet mode is pure CSS, not this function's job
    for (const vh of heights) {
      for (const triggerLeft of [0, 8, 50, Math.max(0, vw - 60), Math.max(0, vw / 2 - 18)]) {
        for (const triggerTop of [0, 8, Math.max(0, vh - 40), Math.max(0, vh / 2)]) {
          const trigger = rect(triggerLeft, triggerTop, 36, 36);
          const pos = computePopoverPosition(trigger, 288, 220, vw, vh, PANEL_GUTTER);
          const withinX = pos.left >= PANEL_GUTTER - 0.001 && pos.left + pos.maxWidth <= vw - PANEL_GUTTER + 0.001;
          const withinY = pos.top >= PANEL_GUTTER - 0.001 && pos.top + pos.maxHeight <= vh - PANEL_GUTTER + 0.001;
          if (!withinX || !withinY) {
            sweepOk = false;
            console.error("  sweep failure", { vw, vh, triggerLeft, triggerTop, pos });
          }
        }
      }
    }
  }
  check("exhaustive sweep: panel always fully within the viewport with an 8px gutter", sweepOk);
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
