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
