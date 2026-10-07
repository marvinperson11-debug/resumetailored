#!/usr/bin/env node
/**
 * Plan-badge regression test (npm run test:plan-badge). Same harness as
 * test-prompts.cjs: transpile the TS on the fly. Pins the rule that each side
 * shows ITS OWN plan, and that the employer sidebar badge and Settings →
 * "Current plan" cannot disagree (the "Corporate vs Free" bug).
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
const { planBadgeFor, planBadgeForPath, sideOfPath } = require(path.join(ROOT, "lib/plan-badge.ts"));

let failures = 0;
const check = (name, ok, detail) => { if (ok) console.log("PASS ", name); else { failures++; console.error("FAIL ", name, detail ? "— " + detail : ""); } };

// Candidate Pro + employer Free: the admin bypass (plan "pro", no employer tier).
const proAdmin = { plan: "pro", type: "individual", isAdmin: true, realAdmin: true };
// Plain Pro subscriber with a stray stored tier of "free".
const proFree = { plan: "pro", type: "individual", tier: "free" };

for (const [label, acc] of [["admin bypass", proAdmin], ["Pro + stored free tier", proFree]]) {
  const cand = planBadgeForPath("/candidate/resumes", acc);
  const emp = planBadgeForPath("/employer/settings", acc);
  check(`${label}: candidate pages show Pro`, cand && cand.side === "candidate" && cand.plan === "pro", JSON.stringify(cand));
  check(`${label}: employer pages show Free (not Corporate)`, emp && emp.side === "employer" && emp.tier === "free", JSON.stringify(emp));
  check(`${label}: neutral pages show no badge`, planBadgeForPath("/sign-in", acc) === null && planBadgeForPath("/employee", acc) === null && planBadgeForPath("/", acc) === null);
}

// Employer badge reads the same value Settings reads (normalizeTier(access.tier)).
const { normalizeTier } = require(path.join(ROOT, "lib/employer-tier.ts"));
for (const tier of [undefined, "free", "portal", "scale", "corporate", "pro", "garbage"]) {
  const acc = { plan: "employer", type: "organization", tier };
  const b = planBadgeFor("employer", acc);
  check(`employer tier ${String(tier)} → badge == Settings value`, b.tier === normalizeTier(tier));
}
// An employer owner is not Pro on the candidate side.
check("employer owner shows Free (not Pro) on candidate pages", planBadgeFor("candidate", { plan: "employer", type: "organization", tier: "corporate" }).plan === "free");
check("invited employee shows employee plan on candidate pages", planBadgeFor("candidate", { plan: "employee", type: "employee" }).plan === "employee");
check("sideOfPath: prefixes are exact (/candidates-x is neutral)", sideOfPath("/candidate") === "candidate" && sideOfPath("/employer/jobs") === "employer" && sideOfPath("/candidates-x") === "neutral" && sideOfPath(null) === "neutral");

// Wiring: the real components must go through the helper (no hardcoded admin "Corporate").
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
check("employer layout uses planBadgeFor and no admin→Corporate shortcut", /planBadgeFor\("employer"/.test(read("app/employer/layout.tsx")) && !/isAdmin \? "Corporate"/.test(read("app/employer/layout.tsx")));
check("employer Settings uses planBadgeFor", /planBadgeFor\("employer"/.test(read("app/employer/settings/page.tsx")));
check("candidate layout uses planBadgeFor", /planBadgeFor\("candidate"/.test(read("app/candidate/layout.tsx")));

if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log("\nALL PASS");
