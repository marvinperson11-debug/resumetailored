#!/usr/bin/env node
/**
 * ONE-TIME backfill for the Nov 9 ruling: Indeed + ZipRecruiter distribution
 * now auto-enables on every plan the moment a job FIRST goes active+public
 * (app/api/employer/jobs/route.ts, app/api/employer/jobs/[id]/route.ts). That
 * auto-enable only fires going forward, on the publish transition itself —
 * it does nothing for a job that was ALREADY live before this shipped. This
 * script closes that gap once: for every job that is CURRENTLY public today
 * (status=active AND public_listed=true — the same predicate as
 * lib/job-posting-lifecycle.ts `isJobCurrentlyPublic`), it enables Indeed +
 * ZipRecruiter and generates that job's employer a feed token, through the
 * exact same real, exported pieces the live publish hook and the channels
 * route use (getDistribution / buildChannelsFromInput / upsertDistribution /
 * ensureEmployerFeedToken) — no logic of its own.
 *
 * NOT part of CI. Run by hand, once, by someone who holds
 * SUPABASE_SERVICE_ROLE_KEY for the deployment. Idempotent and safe to
 * re-run: buildChannelsFromInput merges on top of whatever is already
 * there (never clobbers an employer who has since turned a channel back
 * off — see job 53's own regression test in scripts/test-employer-assistant.cjs),
 * and job_distribution.job_id is the table's primary key, so a re-run
 * upserts the SAME row rather than inserting a duplicate; ensureEmployerFeedToken
 * reuses an employer's existing token rather than regenerating one.
 *
 * It does NOT register anything with Indeed or ZipRecruiter — that stays the
 * employer's own manual step (the feed link + 3-step instructions this
 * script's own log lines print are the same ones the Distribution Panel and
 * Taylor's distribute_job card already show; see lib/job-distribution.ts
 * buildIndeedFeedInstructions/buildZipRecruiterFeedInstructions).
 *
 * REQUIRED environment (not hardcoded, not invented — supply your own):
 *   NEXT_PUBLIC_SUPABASE_URL       the deployment's real Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY      that project's service-role key
 *
 * INVOCATION (from resumetailored-platform/):
 *   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   node scripts/backfill-job-distribution.cjs
 *
 * Optional flags:
 *   --dry-run            log what WOULD change for every currently-public job, write nothing
 *   --only 6,25          restrict to these job ids only (comma-separated) — for a careful first run
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
function flag(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}
const ONLY = (() => {
  const raw = flag("only");
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  return ids.length ? new Set(ids) : null;
})();

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "This script talks to a REAL Supabase project — point it at the deployment you want to backfill,\n" +
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

  const { getDistribution, upsertDistribution, ensureEmployerFeedToken } = load("lib/job-distribution-store.ts");
  const { buildChannelsFromInput, buildIndeedFeedUrl, buildZipRecruiterFeedUrl } = load("lib/job-distribution.ts");
  const { appUrl } = load("lib/subdomain.ts");

  const { data: jobs, error } = await sb.from("job_postings").select("id, employer_id, title, status, public_listed").eq("status", "active").eq("public_listed", true);
  if (error) throw error;

  const targets = ONLY ? (jobs || []).filter((j) => ONLY.has(j.id)) : jobs || [];
  console.log(`${DRY_RUN ? "[dry-run] " : ""}Found ${targets.length} currently-public job(s)${ONLY ? ` (restricted to --only ${[...ONLY].join(",")})` : ""} to backfill.\n`);

  let processed = 0;
  let failed = 0;
  for (const job of targets) {
    const before = await getDistribution(job.employer_id, job.id);
    const channels = buildChannelsFromInput({ indeedFeed: true, zipRecruiter: true, linkedin: false }, before?.channels || null);
    if (DRY_RUN) {
      console.log(`[dry-run] job ${job.id} ("${job.title}", employer ${job.employer_id}): before=${JSON.stringify(before?.channels ?? null)} -> after=${JSON.stringify(channels)}`);
      processed++;
      continue;
    }

    const token = await ensureEmployerFeedToken(job.employer_id);
    const row = await upsertDistribution(job.employer_id, job.id, channels, "ops-backfill-script", null);
    if (!row) {
      console.error(`job ${job.id} ("${job.title}"): upsertDistribution returned null — write failed, see logged Supabase error above.`);
      failed++;
      continue;
    }

    const indeedUrl = token ? buildIndeedFeedUrl(appUrl(), token) : null;
    const zipUrl = token ? buildZipRecruiterFeedUrl(appUrl(), token) : null;
    console.log(
      `job ${job.id} ("${job.title}", employer ${job.employer_id}): ` +
        `indeedFeed=${row.channels?.indeedFeed?.enabled} zipRecruiter=${row.channels?.zipRecruiter?.enabled} ` +
        `feedToken=${token ? "ok" : "MISSING"} indeedFeedUrl=${indeedUrl || "n/a"} zipRecruiterFeedUrl=${zipUrl || "n/a"}`
    );
    processed++;
  }

  console.log(`\n${DRY_RUN ? "[dry-run] would process" : "Processed"} ${processed} job(s)${failed ? `, ${failed} failed` : ""}.`);
  console.log("Nothing was registered with Indeed or ZipRecruiter — that stays the employer's own manual step via the feed link + instructions above.");
  if (failed) process.exit(1);
})().catch((e) => {
  console.error("backfill-job-distribution failed:", e);
  process.exit(1);
});
