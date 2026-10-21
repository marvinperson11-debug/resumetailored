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
 *   - the daily morning brief (Employer Portal AI Assistant, Prompt 3,
 *     lib/assistant-brief.ts) — its own idempotency (`assistant_brief_state.
 *     last_brief_at`) caps it at one send per employer per day regardless of
 *     how often this 30-minute tick happens to fire.
 *   - the runner-up (silver-medalist) pool scan (Employer Portal AI
 *     Assistant, Prompt 4, lib/assistant-runner-up.ts) — its own idempotency
 *     (`job_postings.runner_up_scanned`) means a job is scanned exactly once,
 *     ever, regardless of tick frequency.
 * All three stay behind the one CERT_CRON gate rather than a second env var —
 * one knob for "is the in-process scheduler on", not one per scan.
 *
 * A THIRD, separate loop (every 15s, same CERT_CRON gate — the env name is
 * legacy, kept as-is rather than adding a fourth knob) sends due rows from
 * the Assistant's candidate-message undo queue (Prompt 2,
 * lib/assistant-send-worker.ts). It needs a much shorter interval than the
 * other two: the undo window itself defaults to 60 seconds
 * (ASSISTANT_UNDO_WINDOW_SECONDS), so a 30-minute tick would make "the
 * message sends shortly after the window closes" into "the message sends up
 * to 30 minutes late" — still correct, just not what the UI's countdown
 * promises the employer. The SAME 15s tick also runs the Welcome Email
 * build's grace scan (lib/welcome-email.ts `runWelcomeScan`) — a brand-new,
 * unrelated feature bundled onto this timer rather than a fourth, because it
 * shares no state with the Assistant and its own idempotency
 * (`welcome_comms.state`) makes ticking it this often harmless.
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
  const { runDailyBriefScan } = await import("./lib/assistant-brief");
  const { runRunnerUpScan } = await import("./lib/assistant-runner-up");
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
    try {
      const result = await runDailyBriefScan();
      console.log(`[assistant-brief] scanned ${result.scanned}, sent ${result.sent}, quiet-skipped ${result.quietSkipped}, llm-failed ${result.llmFailed}`);
    } catch (e) {
      console.error("[assistant-brief] scan failed", e);
    }
    try {
      const result = await runRunnerUpScan();
      console.log(`[assistant-runner-up] scanned ${result.scanned} job(s), drafted ${result.created}, no-candidates ${result.flaggedNoCandidates}`);
    } catch (e) {
      console.error("[assistant-runner-up] scan failed", e);
    }
  };

  // A few seconds after boot (let the server finish starting up), then every 30 minutes.
  setTimeout(run, 10_000);
  setInterval(run, TICK_MS);

  const { runAssistantSendQueueScan } = await import("./lib/assistant-send-worker");
  const { runAssistantAckScan } = await import("./lib/assistant-ack-worker");
  const { runWelcomeScan } = await import("./lib/welcome-email");
  const SEND_QUEUE_TICK_MS = 15 * 1000;
  const runSendQueue = async () => {
    try {
      const result = await runAssistantSendQueueScan();
      if (result.scanned) console.log(`[assistant-send-queue] scanned ${result.scanned}, sent ${result.sent}, failed ${result.failed}`);
    } catch (e) {
      console.error("[assistant-send-queue] scan failed", e);
    }
    try {
      // Same 15s cadence as the undo-queue send above (a new applicant should
      // be acknowledged quickly) — bundled into the SAME tick rather than a
      // fourth timer, per this file's own "one knob per cadence" convention.
      const result = await runAssistantAckScan();
      if (result.scanned) console.log(`[assistant-ack-worker] scanned ${result.scanned}, sent ${result.sent}`);
    } catch (e) {
      console.error("[assistant-ack-worker] scan failed", e);
    }
    try {
      // Welcome Email build — unrelated feature, bundled onto this tick (see
      // the header comment above). WELCOME_GRACE_MINUTES (default 30) means
      // the scan itself finds nothing to do on nearly every 15s tick; only
      // the idempotent DB read, not an LLM or email send, runs that often.
      const result = await runWelcomeScan();
      if (result.scanned) console.log(`[welcome-email] scanned ${result.scanned}, sent ${result.sent}`);
    } catch (e) {
      console.error("[welcome-email] scan failed", e);
    }
  };
  setTimeout(runSendQueue, 5_000);
  setInterval(runSendQueue, SEND_QUEUE_TICK_MS);
}
