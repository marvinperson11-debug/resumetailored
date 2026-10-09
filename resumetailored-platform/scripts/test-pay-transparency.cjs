#!/usr/bin/env node
/**
 * Pay-transparency data-capture test (npm run test:pay-transparency).
 * Pins: a posting cannot be PUBLISHED (status "active") without a wage / good-faith
 * wage range AND a general benefits description; drafts may omit them; both the
 * create and edit routes enforce it server-side on the merged result; the public job
 * page renders both. Data-capture rules only — no legal claims.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
  module._compile(out.outputText, filename);
};
const { payTransparencyProblems, cleanPayPeriod, PAY_PERIODS, BENEFITS_MIN_CHARS } = require(path.join(ROOT, "lib/pay-transparency.ts"));
let failures = 0;
const check = (name, ok, detail) => { if (ok) console.log("PASS ", name); else { failures++; console.error("FAIL ", name, detail ? "— " + detail : ""); } };
const ok = { salaryMin: 90000, salaryMax: 130000, benefitsDescription: "Health insurance, 401(k), paid leave." };
const has = (j, p) => payTransparencyProblems(j).includes(p);

check("complete posting has no problems", payTransparencyProblems(ok).length === 0);
check("fixed wage (same amount twice) passes", payTransparencyProblems({ ...ok, salaryMin: 25, salaryMax: 25 }).length === 0);
check("no wage → wage_required", has({ ...ok, salaryMin: null, salaryMax: null }, "wage_required"));
check("min only → wage_required", has({ ...ok, salaryMax: null }, "wage_required"));
check("max only → wage_required", has({ ...ok, salaryMin: null }, "wage_required"));
check("zero wage → wage_required", has({ ...ok, salaryMin: 0, salaryMax: 0 }, "wage_required"));
check("max < min → wage_range_invalid", has({ ...ok, salaryMin: 130000, salaryMax: 90000 }, "wage_range_invalid"));
check("no benefits → benefits_required", has({ ...ok, benefitsDescription: "" }, "benefits_required"));
check("whitespace benefits → benefits_required", has({ ...ok, benefitsDescription: "     " }, "benefits_required"));
check(`benefits under ${BENEFITS_MIN_CHARS} chars → benefits_required`, has({ ...ok, benefitsDescription: "yes" }, "benefits_required"));
check("both missing reports both", payTransparencyProblems({}).length === 2);
check("pay periods", PAY_PERIODS.join() === "hour,week,month,year" && cleanPayPeriod("hour") === "hour" && cleanPayPeriod("decade") === "year" && cleanPayPeriod(undefined) === "year");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const post = read("app/api/employer/jobs/route.ts");
const patch = read("app/api/employer/jobs/[id]/route.ts");
check("POST enforces on publish (422 pay_transparency)", /status === "active"[\s\S]*payTransparencyProblems[\s\S]*pay_transparency[\s\S]*422/.test(post));
check("PATCH enforces on the merged result when active", /effStatus === "active"[\s\S]*payTransparencyProblems\(merged\)[\s\S]*pay_transparency/.test(patch));
check("POST/PATCH accept salaryPeriod + benefitsDescription", /salaryPeriod/.test(post) && /benefitsDescription/.test(post) && /salaryPeriod/.test(patch) && /benefitsDescription/.test(patch));
const page = read("app/jobs/[jobId]/page.tsx");
check("public job page renders benefits + pay period", /job\.benefitsDescription/.test(page) && /salaryPer\./.test(page));
check("job list + career site show the pay period", /salaryPer\./.test(read("app/jobs/page.tsx")) && /salaryPer\./.test(read("app/careers/[slug]/career-site-view.tsx")));
const ui = read("app/employer/jobs/jobs-client.tsx");
check("editor: fields present and publish is validated client-side", /fieldBenefits/.test(ui) && /fieldPayPeriod/.test(ui) && /status === "active"[\s\S]*payTransparencyProblems/.test(ui));
check("migration adds both columns", /salary_period/.test(read("supabase/migrations/0044_job_pay_transparency.sql")) && /benefits_description/.test(read("supabase/migrations/0044_job_pay_transparency.sql")));
const all = [post, patch, page, ui, read("lib/pay-transparency.ts")].join("\n");
check("no compliance/legal guarantee wording in the new code", !/compliant\b|complies|guarantee|legal advice|satisf(y|ies) (the )?(law|act)/i.test(all.replace(/not \w+ (a )?legal/gi, "")));
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
