#!/usr/bin/env node
/**
 * Public-board filter regression test (npm run test:job-quality).
 * The "identical tiny min/max" spam rule must not hide a deliberate fixed wage: a listing with a full
 * wage + benefits description is never hidden by it, while the same pattern with no pay data still is.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
  module._compile(out.outputText, filename);
};
const { listingProblems, isPublishableListing } = require(path.join(ROOT, "lib/job-quality.ts"));
let failures = 0;
const check = (name, ok, detail) => { if (ok) console.log("PASS ", name); else { failures++; console.error("FAIL ", name, detail ? "— " + detail : ""); } };

const desc = "Prepare and serve food and drinks, keep the dining room clean, and help close out the register at the end of each shift. Training provided.";
const benefits = "Paid sick leave, free shift meals, health insurance after 90 days.";

check("fixed $18/hr with full pay data → visible on the board", isPublishableListing({ title: "Server", description: desc, location: "Hartford, CT", salaryMin: 18, salaryMax: 18, benefitsDescription: benefits }), listingProblems({ title: "Server", description: desc, salaryMin: 18, salaryMax: 18, benefitsDescription: benefits }).join());
check("fixed $12/hr with full pay data → visible too", isPublishableListing({ title: "Cashier", description: desc, salaryMin: 12, salaryMax: 12, benefitsDescription: benefits }));
check("a normal range still passes", isPublishableListing({ title: "Server", description: desc, salaryMin: 16, salaryMax: 22, benefitsDescription: benefits }));

// The original spam shape: "Any Walmart · Any Lagrange ga … $12 – $12", no benefits.
const spam = { title: "Any Walmart", description: desc, location: "Any Lagrange ga", salaryMin: 12, salaryMax: 12 };
check("spam pattern with no pay data → still filtered", !isPublishableListing(spam));
check("identical tiny min/max with no benefits text → still flagged degenerate_salary", listingProblems({ title: "Server", description: desc, salaryMin: 12, salaryMax: 12 }).includes("degenerate_salary"));
check("identical tiny min/max with blank benefits → still flagged", listingProblems({ title: "Server", description: desc, salaryMin: 12, salaryMax: 12, benefitsDescription: "   " }).includes("degenerate_salary"));
check("other spam rules unaffected by pay data (placeholder title still filtered)", !isPublishableListing({ ...spam, benefitsDescription: benefits }));
check("other spam rules unaffected (short description still filtered)", !isPublishableListing({ title: "Server", description: "short", salaryMin: 18, salaryMax: 18, benefitsDescription: benefits }));

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
check("create route hands benefitsDescription to the board quality check", /listingProblems\(\{[^}]*benefitsDescription[^}]*\}\)/.test(read("app/api/employer/jobs/route.ts")));
check("board filters the full job (incl. benefitsDescription) through isPublishableListing", /\.filter\(isPublishableListing\)/.test(read("lib/employer-store.ts")) && /isPublishableListing\(mapJob\(row\)\)/.test(read("lib/employer-store.ts")));
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
