/**
 * In-process daily scheduler, off unless `CERT_CRON=on`. Same shape as the
 * sibling Express app's `career-cron.js`: a standalone Railway cron service
 * can't share this app's request context (Clerk/Supabase env, `sendEmail`
 * helpers) as cleanly as running the scan inside the already-deployed web
 * process, and `next start` here is one long-running Node process (not
 * serverless), so `register()` runs exactly once per deploy — a safe place
 * for a `setInterval`.
 *
 * Runs the certification-expiry reminder scan (Phase 3, item 9) once shortly
 * after boot, then every 24h.
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
  const DAY_MS = 24 * 60 * 60 * 1000;

  const run = async () => {
    try {
      const result = await runCertReminderScan();
      console.log(`[cert-cron] scanned ${result.scanned} cert(s), sent ${result.reminded} reminder(s)`);
    } catch (e) {
      console.error("[cert-cron] scan failed", e);
    }
  };

  // A few seconds after boot (let the server finish starting up), then daily.
  setTimeout(run, 10_000);
  setInterval(run, DAY_MS);
}
