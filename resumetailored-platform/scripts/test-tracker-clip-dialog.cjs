#!/usr/bin/env node
/**
 * Regression test for the "Clip a job posting" dialog's submit enablement
 * (app/candidate/tracker/tracker-board.tsx) — run directly with
 * `node scripts/test-tracker-clip-dialog.cjs`.
 *
 * Root cause of the defect this pins: the clip dialog's "open" flag and its
 * "submit in flight" flag were the SAME boolean (`clipping`). Opening the
 * dialog set it true, so the submit button's `loading={clipping && !clipError}`
 * was already true the instant the dialog opened — for any input, valid or
 * not — making the button permanently disabled. The fix splits dialog
 * visibility (`clipOpen`) from submit-in-flight (`clipping`), and gates the
 * button's `disabled` on URL validity (`isValidClipUrl`) instead.
 *
 * This is a source-level regression test (the project's existing convention
 * for small UI checks — see scripts/test-application-tracker.cjs §14), not a
 * full component render: it scans tracker-board.tsx for the wiring, then
 * re-derives `isValidClipUrl`'s own function body from the source and
 * exercises it directly, so the validity logic itself is exact-value tested,
 * not just pattern-matched.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

let failures = 0;
let passes = 0;
const check = (name, ok, detail) => {
  if (ok) {
    passes++;
    console.log("PASS ", name);
  } else {
    failures++;
    console.error("FAIL ", name, detail !== undefined ? "— " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "");
  }
};

const boardSrc = fs.readFileSync(path.join(ROOT, "app/candidate/tracker/tracker-board.tsx"), "utf8");

check(
  "tracker-board: dialog visibility (clipOpen) and submit-in-flight (clipping) are separate state flags",
  /const \[clipOpen, setClipOpen\] = useState/.test(boardSrc) && /const \[clipping, setClipping\] = useState/.test(boardSrc)
);
check("tracker-board: the clip overlay's visibility is gated on clipOpen, not on the submit-in-flight flag", /\{clipOpen && \(/.test(boardSrc));
check(
  "tracker-board: the Clip it button's loading state reflects submission only, never dialog-open state",
  /loading=\{clipping\}/.test(boardSrc) && !/loading=\{clipping && !clipError\}/.test(boardSrc)
);
check("tracker-board: the Clip it button is disabled for an invalid/empty URL, not just while submitting", /disabled=\{!isValidClipUrl\(clipUrl\)\}/.test(boardSrc));

// isValidClipUrl is a private helper in a "use client" component (not exported) —
// re-derive it from its own source text rather than reimplement a parallel check.
const m = /function isValidClipUrl\(value: string\): boolean \{([\s\S]*?)\n\}/.exec(boardSrc);
const isValidClipUrl = m ? new Function("URL", `return function(value) {${m[1]}}`)(URL) : null;
check("isValidClipUrl: helper found in source for direct re-derivation", !!isValidClipUrl);
if (isValidClipUrl) {
  check("isValidClipUrl: a real https URL is valid", isValidClipUrl("https://jobs.example.com/123") === true);
  check("isValidClipUrl: a real http URL is valid", isValidClipUrl("http://jobs.example.com/123") === true);
  check("isValidClipUrl: a URL with surrounding whitespace (paste artifact) is valid", isValidClipUrl("  https://jobs.example.com/123  ") === true);
  check("isValidClipUrl: empty string is invalid", isValidClipUrl("") === false);
  check("isValidClipUrl: a bare domain with no scheme is invalid", isValidClipUrl("jobs.example.com") === false);
  check("isValidClipUrl: a non-http(s) scheme is invalid", isValidClipUrl("javascript:alert(1)") === false);
  check("isValidClipUrl: garbage text is invalid", isValidClipUrl("not a url at all") === false);
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) {
  console.error("FAILURES DETECTED");
  process.exit(1);
}
console.log("ALL PASS");
