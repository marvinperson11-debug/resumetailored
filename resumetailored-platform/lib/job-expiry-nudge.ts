import { listPublishedJobsForLifecycleScan, markJobExpiryNudged } from "./employer-store";
import { logActivityForEmployer } from "./notifications-store";
import { isJobPastValidThrough, isNudgeDue } from "./job-posting-lifecycle";

/**
 * Job-posting expiry nudge (Kimi prompt v3, ruling 5): a published job past
 * its computed validThrough window is NEVER auto-closed and NEVER silently
 * extended — the employer is nudged, at most once per job per week, until
 * they close it or extend the date themselves. Ticked every 30 minutes from
 * instrumentation.ts, same isolation convention as lib/interview-reminders.ts:
 * this file's import graph stays to employer-store.ts/notifications-store.ts/
 * job-posting-lifecycle.ts only — no lib/employer-plan.ts or
 * lib/employer-notify.ts, which reach Node's `crypto` via lib/docusign.ts and
 * break the edge-runtime compile instrumentation.ts also goes through.
 *
 * Applies at every tier: a job's own expiry isn't gated by plan (unlike
 * distribute_job) — Google Jobs markup and the validThrough window exist for
 * every public listing (ruling 1), so the nudge does too.
 */
export async function runJobExpiryNudgeScan(now: number = Date.now()): Promise<{ scanned: number; nudged: number }> {
  const jobs = await listPublishedJobsForLifecycleScan();
  let nudged = 0;
  for (const job of jobs) {
    if (!isJobPastValidThrough(job, now) || !isNudgeDue(job.expiryNudgedAt, now)) continue;
    await logActivityForEmployer(job.employerId, {
      eventType: "job_expiry_nudge",
      title: `Your post for "${job.title}" expired its 30-day window`,
      body: "Close it or extend the date — it's still live on the public job board until you do.",
      link: `/employer/jobs/${job.id}`,
    }).catch(() => {});
    await markJobExpiryNudged(job.id, new Date(now).toISOString());
    nudged++;
  }
  return { scanned: jobs.length, nudged };
}
