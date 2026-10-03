#!/usr/bin/env node
/**
 * Skills-gap unit tests (npm run test:skills-gap). Same harness as test-prompts:
 * compile lib/skills-gap.ts on the fly, assert with plain checks.
 * Covers: punctuation stripping, count-vs-rendered consistency (the chips the UI
 * renders are exactly present[] / missing[], each unique and disjoint), and
 * false "missing" flags (case, plurals, hyphenated compounds).
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
const { analyzeSkillGap } = require(path.join(ROOT, "lib/skills-gap.ts"));

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) console.log("PASS ", name);
  else { failures++; console.error("FAIL ", name, detail ? "— " + detail : ""); }
};
const all = (g) => [...g.present, ...g.missing];

// 1. Punctuation stripping
{
  const job = "Collaborate with product teams. Ship new features. Own roadmap, analytics; and dashboards!";
  const g = analyzeSkillGap("Python developer", job);
  const bad = all(g).filter((w) => /[.,;:!?]$/.test(w));
  check("no trailing punctuation on tokens", bad.length === 0, JSON.stringify(bad));
  check("'features' present without period", all(g).includes("features"), JSON.stringify(all(g)));
}

// 2. Count vs rendered: UI renders one chip per entry and prints items.length
{
  const job = "Own roadmap roadmap roadmap. Roadmap, analytics, analytics; SQL and sql. Teams. teams team. Features features.";
  const g = analyzeSkillGap("I know SQL.", job);
  const uniq = (a) => new Set(a).size === a.length;
  check("present has no duplicates", uniq(g.present), JSON.stringify(g.present));
  check("missing has no duplicates", uniq(g.missing), JSON.stringify(g.missing));
  check("present and missing are disjoint", uniq(all(g)), JSON.stringify(all(g)));
  check("sql counted once, case-insensitively, as present", g.present.filter((w) => w === "sql").length === 1);
}
{
  const words = Array.from({ length: 40 }, (_, i) => `keyword${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i * 7) % 26))}`);
  const g = analyzeSkillGap(words.slice(0, 4).join(" "), words.join(" "), 19);
  check("limit respected: present+missing === 19", g.present.length + g.missing.length === 19, `${g.present.length}+${g.missing.length}`);
  check("4 in-resume keywords render exactly 4", g.present.length === 4, String(g.present.length));
  check("15 missing keywords render exactly 15", g.missing.length === 15, String(g.missing.length));
}

// 3. False missing flags
{
  const resume = "Led a cross-functional team of 6 engineers.";
  const g = analyzeSkillGap(resume, "We need a cross-functional teams player. Cross functional collaboration.");
  for (const w of ["cross", "functional", "teams", "team", "cross-functional"]) {
    check(`'${w}' not flagged missing`, !g.missing.includes(w), JSON.stringify(g.missing));
  }
  check("cross-functional compound matched as present", g.present.includes("cross-functional"), JSON.stringify(g));
}
{
  const g = analyzeSkillGap("PYTHON and Node.js, REACT", "python, Node.js and react. Kubernetes.");
  check("case-insensitive match", g.present.includes("python") && g.present.includes("react"), JSON.stringify(g));
  check("node.js keeps inner dot, matches", g.present.includes("node.js"), JSON.stringify(g));
  check("genuinely absent keyword stays missing", g.missing.includes("kubernetes"), JSON.stringify(g));
}
{
  // a part of the resume's hyphenated compound satisfies a job's separate word and vice versa
  const g1 = analyzeSkillGap("Built data-driven dashboards", "Be data driven with dashboards");
  check("'data-driven' resume matches split 'data' and 'driven'", !g1.missing.includes("data") && !g1.missing.includes("driven"), JSON.stringify(g1));
  const g2 = analyzeSkillGap("Strong data driven mindset", "Data-driven decisions");
  check("split resume words match job compound 'data-driven'", g2.present.includes("data-driven"), JSON.stringify(g2));
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nALL PASS");
