/**
 * In-process scheduler, off unless `CERT_CRON=on`. Same shape as the sibling
 * Express app's `career-cron.js`: a standalone Railway cron service can't
 * share this app's request context (Clerk/Supabase env, `sendEmail` helpers)
 * as cleanly as running the scan inside the already-deployed web process, and
 * `next start` here is one long-running Node process (not serverless), so
 * `register()` runs exactly once per deploy — a safe place for a
 * `setInterval`.
 *
 * Runs two scans shortly after boot, then every 30 minutes:
 *   - the certification-expiry reminder scan (Phase 3, item 9) — unchanged
 *     behavior, just a shorter interval. Its own windows are wide (30/7 DAYS)
 *     and idempotent, so ticking more often than daily is harmless: a
 *     within-the-hour re-run simply finds nothing newly due.
 *   - the interview reminder scan (Employer Portal AI Assistant, Phase 0,
 *     lib/interview-reminders.ts) — THIS is why the interval had to drop
 *     below a day: its windows are 24h/2h, so a daily tick could miss the 2h
 *     window for an interview booked same-day.
 * Both stay behind the one CERT_CRON gate rather than a second env var — one
 * knob for "is the in-process scheduler on", not one per scan.
 */
export async function register() {
  // Fail loud at boot: the signed-out free tier keys its quotas on GUEST_QUOTA_SALT, and a
  // missing one must stop the server rather than surface on the first anonymous request.
  // (register() runs when the server starts, not during `next build`.) The positive
  // NEXT_RUNTIME check is deliberate — it is what keeps the node-only import out of the
  // edge compile of this file; an early `return` is not enough for that.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { requireGuestConfigOrExit } = await import("./lib/boot-checks");
    requireGuestConfigOrExit();
    // Prove the quota store works from THIS deployment's own connection (result goes to the log).
    const { startGuestSelfTest } = await import("./lib/boot-checks");
    const { guestSelfTest } = await import("./lib/guest");
    startGuestSelfTest(guestSelfTest);
  }

  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.CERT_CRON !== "on") return;

  const { runCertReminderScan } = await import("./lib/cert-cron");
  const { runInterviewReminderScan } = await import("./lib/interview-reminders");
  const TICK_MS = 30 * 60 * 1000;

  const run = async () => {
    try {
      const result = await runCertReminderScan();
      console.log(`[cert-cron] scanned ${result.scanned} cert(s), sent ${result.reminded} reminder(s)`);
    } catch (e) {
      console.error("[cert-cron] scan failed", e);
    }
    try {
      const result = await runInterviewReminderScan();
      console.log(`[interview-reminders] scanned ${result.scanned} interview(s), sent ${result.reminded} reminder(s)`);
    } catch (e) {
      console.error("[interview-reminders] scan failed", e);
    }
  };

  // A few seconds after boot (let the server finish starting up), then every 30 minutes.
  setTimeout(run, 10_000);
  setInterval(run, TICK_MS);
}
