#!/usr/bin/env node
/**
 * One-time, migration-free data pass (Q&A Grounding Consistency fix,
 * Prompt 6 follow-up — the Oct 24 job 21 live finding).
 *
 * Before the enablement gate in lib/assistant-mutations.ts existed,
 * `enable_candidate_qa` could be approved for a draft/closed/unlisted job —
 * leaving `job_faqs.enabled = true` on a job the live inbound path
 * (lib/assistant-qa.ts) would ground on EMPTY fields for, because it always
 * checked `isJobPublished`. `runCleanup` below finds every job_faqs row left
 * in that inconsistent state and disables it, writing one
 * `assistant_audit_log` row per job so the cleanup itself is auditable
 * (same table/convention as every other system action logged there —
 * lib/assistant-audit.ts).
 *
 * Idempotent — safe to run more than once; a job already consistent (either
 * genuinely published, or already disabled) is left untouched.
 * `last_enabled_at` is intentionally NOT reset — same clock semantics as a
 * normal disable (lib/job-faq-store.ts `setJobFaqEnabled`): re-publishing
 * the job later does not auto-re-enable Q&A, the sample-first approval is
 * required again.
 *
 * Run once, by hand, in an environment with the real Supabase env vars set:
 *   node scripts/cleanup-qa-inconsistency.cjs            # applies the fix
 *   node scripts/cleanup-qa-inconsistency.cjs --dry-run  # reports only
 */
const { createClient } = require("@supabase/supabase-js");

function isPublished(job) {
  return job.status === "active" && !!job.public_listed;
}

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("[qa-cleanup] Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** The cleanup pass itself, independent of the CLI wrapper below so it can
 *  be driven directly against a test double. Returns a summary rather than
 *  just logging, so a caller (or a test) can assert on exactly what was
 *  found/fixed. */
async function runCleanup(client, { dryRun = false } = {}) {
  const disabledJobIds = [];

  const { data: faqRows, error: faqErr } = await client.from("job_faqs").select("job_id, employer_id, last_enabled_at").eq("enabled", true);
  if (faqErr) throw new Error(`[qa-cleanup] Could not read job_faqs: ${JSON.stringify(faqErr)}`);
  if (!faqRows || !faqRows.length) return { checked: 0, inconsistentCount: 0, disabledJobIds };

  const jobIds = faqRows.map((r) => r.job_id);
  const { data: jobs, error: jobErr } = await client.from("job_postings").select("id, employer_id, status, public_listed, title").in("id", jobIds);
  if (jobErr) throw new Error(`[qa-cleanup] Could not read job_postings: ${JSON.stringify(jobErr)}`);
  const jobById = new Map((jobs || []).map((j) => [j.id, j]));

  let inconsistentCount = 0;
  for (const row of faqRows) {
    const job = jobById.get(row.job_id);
    if (!job) continue; // job gone/inaccessible — nothing to reconcile here
    if (isPublished(job)) continue; // consistent — leave it alone

    inconsistentCount += 1;
    console.log(`[qa-cleanup] job ${row.job_id} ("${job.title}", status=${job.status}, public_listed=${!!job.public_listed}) has Candidate Q&A enabled while not published.`);
    if (dryRun) continue;

    const { error: updErr } = await client
      .from("job_faqs")
      .update({ enabled: false, updated_at: new Date().toISOString() }) // last_enabled_at intentionally untouched
      .eq("job_id", row.job_id);
    if (updErr) {
      console.error(`[qa-cleanup] Could not disable job_faqs for job ${row.job_id}`, updErr);
      continue;
    }

    const { error: auditErr } = await client.from("assistant_audit_log").insert({
      employer_id: row.employer_id,
      actor_user_id: "system",
      actor_email: null,
      action: "candidate_qa_disabled_for_inconsistency",
      target_type: "job",
      target_id: String(row.job_id),
      payload_json: { reason: "enabled_while_not_published", jobStatus: job.status, publicListed: !!job.public_listed, lastEnabledAt: row.last_enabled_at },
      status: "executed",
    });
    if (auditErr) console.error(`[qa-cleanup] Could not write audit row for job ${row.job_id}`, auditErr);

    disabledJobIds.push(row.job_id);
  }

  return { checked: faqRows.length, inconsistentCount, disabledJobIds };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = await runCleanup(db(), { dryRun });
  console.log(`[qa-cleanup] Done. ${result.inconsistentCount} inconsistent job(s) found${dryRun ? " (dry run — nothing written)" : ", disabled with one audit row each"}.`);
}

module.exports = { runCleanup, isPublished };

if (require.main === module) {
  main().catch((e) => {
    console.error("[qa-cleanup] fatal", e);
    process.exit(1);
  });
}
