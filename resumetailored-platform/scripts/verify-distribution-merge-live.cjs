#!/usr/bin/env node
/**
 * MANUAL live verification of the Distribution Fix (merge, don't replace —
 * lib/job-distribution.ts buildChannelsFromInput). Not part of CI; run by
 * hand against the real deployment's Supabase project, by someone who holds
 * SUPABASE_SERVICE_ROLE_KEY for that project. This is step 2 of the live
 * verification checklist: approve a single channel on a job that already
 * has a DIFFERENT channel enabled, through the real non-assistant write
 * path, and prove the existing channel survives.
 *
 * It deliberately does NOT go through the employer chat assistant (which
 * has been erroring since Oct 26) and does NOT call executeDistributeJob
 * directly — that function is not exported from lib/assistant-mutations.ts.
 * Instead it drives the exact same real, exported pieces executeDistributeJob
 * itself calls with no logic of its own in between:
 *   lib/job-distribution-store.ts  getDistribution   (read the existing row)
 *   lib/job-distribution.ts        buildChannelsFromInput  (the merge fix)
 *   lib/job-distribution-store.ts  upsertDistribution       (the write)
 * This is the real production code for every line that matters to this fix;
 * the only thing not exercised is the pending-action approval wrapper around
 * it (permission checks, the audit-log row, the chat card), which carries no
 * channel logic of its own.
 *
 * REQUIRED environment (not hardcoded, not invented — supply your own):
 *   NEXT_PUBLIC_SUPABASE_URL       the deployment's real Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY      that project's service-role key
 *
 * INVOCATION (from resumetailored-platform/):
 *   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   node scripts/verify-distribution-merge-live.cjs --job 30 --channel zipRecruiter
 *
 * Optional flags:
 *   --channel indeedFeed|zipRecruiter|linkedin   channel to approve (default zipRecruiter)
 *   --actor-user-id <id>                          actor_user_id written to the row (default "ops-verify-script")
 *   --actor-email <email>                         actor_email written to the row (default null)
 *   --idempotent-check                            after the main run, approve the SAME channel again and
 *                                                  assert the row is byte-for-byte unchanged (checklist step 5)
 *
 * What it does, in order:
 *   1. Looks up job 30's employer_id from job_postings (never hardcoded — a
 *      wrong employer_id would silently write a row for the wrong tenant).
 *   2. Reads the CURRENT job_distribution row for that job (the "before").
 *   3. Builds the merged channels object via the real buildChannelsFromInput
 *      with that row as `existing`.
 *   4. Writes it via the real upsertDistribution.
 *   5. Reads the row back and prints before/after so the operator can see,
 *      in one place, that the pre-existing channel was not clobbered.
 *   6. With --idempotent-check, repeats steps 3-5 once more and diffs the
 *      two "after" snapshots — must be identical.
 *
 * This script makes no changes to jobs 29 or 31 — it only ever touches the
 * single --job id you pass it, and only that job's job_distribution row.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
function flag(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}
const JOB_ID = Number(flag("job"));
const CHANNEL = flag("channel", "zipRecruiter");
const ACTOR_USER_ID = flag("actor-user-id", "ops-verify-script");
const ACTOR_EMAIL = flag("actor-email", null);
const CHECK_IDEMPOTENT = args.includes("--idempotent-check");

if (!Number.isFinite(JOB_ID)) {
  console.error('Usage: node scripts/verify-distribution-merge-live.cjs --job <id> [--channel indeedFeed|zipRecruiter|linkedin] [--idempotent-check]');
  process.exit(1);
}
if (!["indeedFeed", "zipRecruiter", "linkedin"].includes(CHANNEL)) {
  console.error(`--channel must be one of indeedFeed, zipRecruiter, linkedin (got "${CHANNEL}")`);
  process.exit(1);
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "This script talks to a REAL Supabase project — point it at the deployment you want to verify,\n" +
      "using the operator's own credentials for that project. Nothing here is faked or defaulted."
  );
  process.exit(1);
}

const transpile = (mod, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  mod._compile(out.outputText, filename);
};
require.extensions[".ts"] = transpile;
const load = (rel) => require(path.join(ROOT, rel));

(async () => {
  const { createClient } = require("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: job, error: jobErr } = await sb.from("job_postings").select("id, employer_id, title, status").eq("id", JOB_ID).maybeSingle();
  if (jobErr) throw jobErr;
  if (!job) { console.error(`No job_postings row with id ${JOB_ID}.`); process.exit(1); }
  const employerId = job.employer_id;
  console.log(`Job ${JOB_ID} ("${job.title}", status=${job.status}) belongs to employer ${employerId}`);

  const { getDistribution, upsertDistribution } = load("lib/job-distribution-store.ts");
  const { buildChannelsFromInput } = load("lib/job-distribution.ts");

  const approveOnce = async (label) => {
    const before = await getDistribution(employerId, JOB_ID);
    console.log(`\n[${label}] before:`, JSON.stringify(before?.channels ?? null));
    const input = { indeedFeed: CHANNEL === "indeedFeed", linkedin: CHANNEL === "linkedin", zipRecruiter: CHANNEL === "zipRecruiter" };
    const merged = buildChannelsFromInput(input, before?.channels || null);
    const row = await upsertDistribution(employerId, JOB_ID, merged, ACTOR_USER_ID, ACTOR_EMAIL);
    if (!row) { console.error(`[${label}] upsertDistribution returned null — write failed, see logged Supabase error above.`); process.exit(1); }
    console.log(`[${label}] after: `, JSON.stringify(row.channels));
    return row.channels;
  };

  const after1 = await approveOnce(`approve ${CHANNEL}`);

  if (CHECK_IDEMPOTENT) {
    const after2 = await approveOnce(`re-approve ${CHANNEL} (idempotent check)`);
    const same = JSON.stringify(after1) === JSON.stringify(after2);
    console.log(`\nidempotent check: ${same ? "PASS — unchanged on re-approval" : "FAIL — channels drifted between approvals"}`);
    if (!same) process.exit(1);
  }

  console.log("\nDone. Confirm by eye above that every channel present in the FIRST \"before\" snapshot is still present in the final \"after\" snapshot.");
})().catch((e) => {
  console.error("verify-distribution-merge-live failed:", e);
  process.exit(1);
});
