#!/usr/bin/env node
/**
 * Real-Supabase smoke run (Step 2) against STAGING. NOT part of CI.
 *   NEXT_PUBLIC_SUPABASE_URL=<staging> SUPABASE_SERVICE_ROLE_KEY=<staging> ANTHROPIC_API_KEY=... \
 *   SMOKE_USER_ID=<a Clerk user id used only for smoke rows> node scripts/smoke-staging.cjs
 * Drives the same engine the routes call (runStoredVacancy / processBatch) against the real database,
 * Storage bucket and model. It does NOT exercise Clerk: Clerk-authenticated HTTP must be checked against a
 * deployed staging app (sign in, POST /api/documents/generate and /batch). The app only ever uses the
 * service-role key for these tables, which bypasses RLS, so RLS denial is not expected on this path.
 */
const fs = require("fs"), path = require("path"), ts = require("typescript"), JSZip = require("jszip");
const ROOT = path.resolve(__dirname, "..");
require.extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "SMOKE_USER_ID"]) if (!process.env[k]) { console.error(`${k} is required`); process.exit(2); }
const { createVacancy, docsDb, getFile, signedUrl } = require(path.join(ROOT, "lib/docs/store.ts"));
const { anthropicLlm, runStoredVacancy, processBatch } = require(path.join(ROOT, "lib/docs/runner.ts"));
const U = process.env.SMOKE_USER_ID;
const PROFILE = `Sanjan Rahman\nsanjan@example.com | +61 400 111 222\nSydney, NSW\n\nEXPERIENCE\nSenior Civil Engineer, Harbour Infrastructure Pty Ltd, Mar 2021 - Present\n- Led design of 3 bridge rehabilitation projects worth $14M\n- Managed a team of 6 engineers\nCivil Engineer, Coastal Works Pty Ltd, Jan 2017 - Feb 2021\n- Designed stormwater drainage for 12 residential subdivisions\n\nEDUCATION\nBachelor of Engineering (Civil), University of Sydney, 2016\n`;
const VACS = [["Northern Rail Corporation", "Principal Engineer"], ["Southern Water Authority", "Senior Bridge Engineer"], ["Acme Mining Pty Ltd", "Project Engineer"]];
let bad = 0; const ok = (n, c, d) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : JSON.stringify(d)); if (!c) bad++; };
const fetchBuf = async (url) => Buffer.from(await (await fetch(url)).arrayBuffer());
const isDocx = async (b) => { const z = await JSZip.loadAsync(b); return !!z.file("word/document.xml") && !!z.file("[Content_Types].xml"); };

(async () => {
  const c = docsDb(); const llm = anthropicLlm();
  const probe = await c.from("vacancies").select("id").limit(1);
  ok("migration 0049: vacancies / document_batches / document_batch_items are reachable", !probe.error && !(await c.from("document_batches").select("id").limit(1)).error && !(await c.from("document_batch_items").select("id").limit(1)).error, probe.error);

  const v = await createVacancy(U, { employer: VACS[0][0], position: VACS[0][1], description: `${VACS[0][0]} is hiring a ${VACS[0][1]} to lead bridge asset renewal.` });
  const run = await runStoredVacancy({ userId: U, vacancyId: v.id, profileText: PROFILE, llm, tier: "paid" });
  ok("single: resume + cover letter generated, no errors", run && run.paths.resume && run.paths.coverLetter && !run.result.errors.length, run && run.result.errors);
  for (const [k, p] of Object.entries(run.paths)) {
    const url = await signedUrl(p, `${k}.docx`); const res = await fetch(url);
    ok(`single: ${k} signed URL downloads with a docx content type and is a valid .docx`, res.ok && /wordprocessingml|octet-stream/.test(res.headers.get("content-type") || "") && await isDocx(Buffer.from(await res.arrayBuffer())), [res.status, res.headers.get("content-type")]);
  }

  const { data: batch } = await c.from("document_batches").insert({ user_id: U, status: "queued", profile_text: PROFILE }).select("id").single();
  const rows = [];
  for (let i = 0; i < VACS.length; i++) { const vv = await createVacancy(U, { employer: VACS[i][0], position: VACS[i][1], description: `${VACS[i][0]} is hiring a ${VACS[i][1]}.` }); rows.push({ batch_id: batch.id, user_id: U, vacancy_id: vv.id, position: i, status: "pending" }); }
  await c.from("document_batch_items").insert(rows);
  await processBatch(batch.id);
  const { data: done } = await c.from("document_batches").select("status, zip_path").eq("id", batch.id).single();
  ok("batch: finished with status done and a ZIP in Storage", done.status === "done" && !!done.zip_path, done);
  const zip = await JSZip.loadAsync(await getFile(done.zip_path));
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
  console.log(names.join("\n"));
  ok("batch: ZIP = EmployerName_PositionTitle/{CoverLetter.docx, Resume.docx} for all 3", names.length === 6 && VACS.every(([e, p]) => ["Resume.docx", "CoverLetter.docx"].every((f) => names.includes(`${e.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").map((w) => w[0].toUpperCase() + w.slice(1)).join("")}_${p.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").map((w) => w[0].toUpperCase() + w.slice(1)).join("")}/${f}`))), names);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
