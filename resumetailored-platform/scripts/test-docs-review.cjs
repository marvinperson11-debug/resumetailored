#!/usr/bin/env node
/**
 * Batch status per-item review (run by npm run test:documents). Offline: the model is a stub; the pipeline and
 * itemReview are real. The review entries must use the errors[] shape { kind, code, message } exactly, carry the
 * recorded reason, and agree with what the row stores.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");
require.extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
const { runVacancyPackage } = require(path.join(ROOT, "lib/docs/pipeline.ts"));
const { itemReview } = require(path.join(ROOT, "lib/docs/review.ts"));

let failures = 0;
const check = (name, cond, detail) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${JSON.stringify(detail)}`}`); if (!cond) failures++; };
const shapeOk = (entries) => entries.every((e) => JSON.stringify(Object.keys(e)) === '["kind","code","message"]' && ["kind", "code", "message"].every((k) => typeof e[k] === "string"));

const PROFILE = "Sanjan Rahman\nsanjan@example.com\n\nEXPERIENCE\nCivil Engineer, Coastal Works Pty Ltd, 2017 - 2021\n- Designed stormwater drainage\n\nEDUCATION\nBachelor of Engineering (Civil), University of Sydney, 2016\n";
const V = { id: "vac-r", employer: "Northern Rail Corporation", position: "Principal Engineer", description: "d" };
// A resume that invents an employer (flags → withheld) and a letter for the wrong employer (gate refuses it).
const resumeReply = JSON.stringify({ name: "Sanjan Rahman", contact: [], summary: "Engineer.", skills: ["Drainage"], education: [{ degree: "Bachelor of Engineering (Civil)", school: "University of Sydney", dates: "2016" }],
  experience: [{ title: "Civil Engineer", company: "Invented Dynamics Pty Ltd", dates: "2017 - 2021", bullets: ["Designed stormwater drainage"] }] });
const letterReply = JSON.stringify({ sender: { name: "Sanjan Rahman", contact: [] }, employer: "Southern Water Authority", position: V.position, salutation: "Dear Hiring Manager,", signOff: "Sincerely,",
  paragraphs: ["I am applying to Southern Water Authority for the Principal Engineer role.", "Thank you."] });
const llm = async ({ system }) => (/cover letter/i.test(system) ? letterReply : resumeReply);

(async () => {
  const origWarn = console.warn; console.warn = () => {};
  const r = await runVacancyPackage({ vacancy: V, profileText: PROFILE, llm, otherEmployers: ["Southern Water Authority"] });
  console.warn = origWarn;
  // What runner.ts stores on the batch item row.
  const flags = r.resume ? r.resume.flags : [];
  const errors = r.errors;
  const review = itemReview(flags, errors);
  check("fixture: resume was flagged and the cover letter refused", flags.length > 0 && errors.some((e) => e.code === "employer_mismatch"), { flags, errors });
  check("review: every entry is exactly { kind, code, message } (strings)", shapeOk(review), review);
  const nr = review.find((e) => e.code === "needs_review");
  check("review: a withheld resume is kind 'resume', code 'needs_review', with the recorded flag reason in the message", nr && nr.kind === "resume" && nr.message.includes('"Invented Dynamics Pty Ltd"'), review);
  check("review: the message uses the ZIP review note's wording ('Resume withheld. <flag messages>')", nr && nr.message === `Resume withheld. ${flags.map((f) => f.message).join(" ")}`, nr);
  const cl = review.filter((e) => e.kind === "cover_letter");
  check("review: each recorded error appears with its kind, code and message unchanged", cl.length === 1 && errors.every((e) => review.some((x) => x.kind === e.kind && x.code === e.code && x.message === e.message)), { review, errors });

  check("review: a done item (no flags, no errors) has an empty review", itemReview([], []).length === 0);
  check("review: null/garbage row values do not throw and yield nothing", itemReview(null, undefined).length === 0 && itemReview("x", [null, 3]).length === 0);
  const runner = itemReview([], [{ kind: "vacancy", code: "not_found", message: "Vacancy not found." }, { kind: "run", code: "exception", message: "boom" }]);
  check("review: runner-level errors (vacancy not_found, run exception) pass through in the same shape", shapeOk(runner) && runner.length === 2 && runner[0].code === "not_found" && runner[1].kind === "run", runner);

  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((e) => { console.error(e); process.exit(1); });
