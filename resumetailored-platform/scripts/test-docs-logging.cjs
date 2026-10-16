#!/usr/bin/env node
/**
 * Server-side logging of document-pipeline failures (run by npm run test:documents, after test-documents.cjs).
 * Offline: the model is a stub that throws. The user-facing error stays the generic one; the raw cause must reach
 * the server log, because the batch rows that also hold it are deleted by cleanup.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const Anthropic = require("@anthropic-ai/sdk");
const ROOT = path.resolve(__dirname, "..");
require.extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
const { runVacancyPackage } = require(path.join(ROOT, "lib/docs/pipeline.ts"));

let failures = 0;
const check = (name, cond, detail) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${JSON.stringify(detail)}`}`); if (!cond) failures++; };
const PROFILE = "Sanjan Rahman\nsanjan@example.com\n\nEXPERIENCE\nCivil Engineer, Coastal Works Pty Ltd, 2017 - 2021\n";
const V = { id: "vac-log-1", employer: "Northern Rail Corporation", position: "Principal Engineer", description: "d" };

/** Run fn with console.error captured; returns the captured lines. */
async function captureErrors(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...a) => lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  try { await fn(); } finally { console.error = orig; }
  return lines;
}

(async () => {
  // 1. The smoke-run case: an Anthropic 400 (credit balance) thrown from the model call.
  const credit = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }, undefined, new Headers());
  let out;
  const lines = await captureErrors(async () => { out = await runVacancyPackage({ vacancy: V, profileText: PROFILE, llm: async () => { throw credit; }, kinds: ["cover_letter"] }); });
  check("api error: user-facing error is still exactly the generic one", out.errors.length === 1 && out.errors[0].code === "failed" && out.errors[0].message === "Generation failed. Please try again.", out.errors);
  const line = lines.find((l) => l.startsWith("[docs/pipeline] generation failed")) || "";
  const logged = line ? JSON.parse(line.slice(line.indexOf("{"))) : {};
  check("api error: one server log line for the coerced throw", lines.filter((l) => l.startsWith("[docs/pipeline]")).length === 1, lines);
  check("api error: log carries class, category, status and API error type", logged.name === "BadRequestError" && logged.category === "api" && logged.status === 400 && logged.type === "invalid_request_error", logged);
  check("api error: log carries the raw message verbatim", /credit balance is too low/.test(logged.message || ""), logged);
  check("api error: log carries kind + vacancy id, and no profile text", logged.kind === "cover_letter" && logged.vacancyId === V.id && !line.includes("Coastal Works"), logged);

  // 2. A non-API throw (a bug in render/scrub, say) is logged as internal.
  const lines2 = await captureErrors(async () => { await runVacancyPackage({ vacancy: V, profileText: PROFILE, llm: async () => { throw new TypeError("cannot read properties of undefined"); }, kinds: ["resume"] }); });
  const l2 = JSON.parse((lines2.find((l) => l.startsWith("[docs/pipeline] generation failed")) || "x {}").replace(/^[^{]*/, ""));
  check("internal error: logged with class TypeError, category internal, verbatim message", l2.name === "TypeError" && l2.category === "internal" && l2.message === "cannot read properties of undefined" && l2.kind === "resume", l2);

  // 3. A thrown non-Error value is still recorded.
  const lines3 = await captureErrors(async () => { await runVacancyPackage({ vacancy: V, profileText: PROFILE, llm: async () => { throw "socket hang up"; }, kinds: ["resume"] }); });
  const l3 = JSON.parse((lines3.find((l) => l.startsWith("[docs/pipeline] generation failed")) || "x {}").replace(/^[^{]*/, ""));
  check("non-Error throw: logged with category non_error and its string value", l3.category === "non_error" && l3.message === "socket hang up", l3);

  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((e) => { console.error(e); process.exit(1); });
