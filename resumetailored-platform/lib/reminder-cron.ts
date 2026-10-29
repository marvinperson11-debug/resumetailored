import { listPendingReminders, markReminderFired, reminderIsDue, type ReminderRow } from "./employer-reminders";
import { sendEmail, resolveUserEmail, escapeHtml, emailShell } from "./email";
import { logActivityForEmployer } from "./notifications-store";

/**
 * Employer-internal reminders — the 15s scan (Taylor Combined Build v5,
 * Section B). Ticked from instrumentation.ts's existing 15s loop, alongside
 * lib/assistant-send-worker.ts and lib/assistant-ack-worker.ts.
 *
 * DELIBERATELY self-contained, same reasoning as lib/interview-reminders.ts's
 * own header comment: this file is reachable from instrumentation.ts, which
 * Next also tries to compile for the EDGE runtime, so its import graph stays
 * off anything that reaches lib/docusign.ts -> Node's `crypto`. email.ts and
 * notifications-store.ts (plain fetch + supabase-js) are both already proven
 * safe here by lib/cert-cron.ts and lib/assistant-ack-worker.ts.
 *
 * Delivery is BOTH an in-app notification (the employer's own bell,
 * `audience: 'employer'`) and an email to the employer's own address — never
 * a candidate. `markReminderFired` is the one idempotency guard: it only
 * stamps a row whose `fired_at` is still null, so an overlapping or retried
 * tick can never deliver the same reminder twice even if the notification/
 * email step below is reached more than once for the same row.
 */

async function notifyEmployerOfReminder(reminder: ReminderRow): Promise<void> {
  logActivityForEmployer(reminder.employerId, {
    eventType: "reminder_due",
    title: reminder.title,
    body: reminder.note || undefined,
    link: "/employer/scheduler",
  }).catch(() => {});

  const to = await resolveUserEmail(reminder.employerId).catch(() => null);
  if (!to) return;
  const title = escapeHtml(reminder.title);
  const note = reminder.note ? `<p style="font-size:14px;color:#444">${escapeHtml(reminder.note)}</p>` : "";
  await sendEmail({
    to,
    subject: `Reminder: ${reminder.title}`,
    html: emailShell(`<p>You asked to be reminded:</p><p style="font-size:16px;font-weight:600">${title}</p>${note}`),
  }).catch(() => false);
}

export interface ReminderScanResult {
  scanned: number;
  fired: number;
}

/** Scan every employer's own pending reminders and fire any that are due.
 *  Safe to run as often as desired — `reminderIsDue` is a pure, deterministic
 *  check, and `markReminderFired`'s `fired_at is null` guard makes a re-run
 *  before anything new has come due a no-op. */
export async function runReminderScan(now: number = Date.now()): Promise<ReminderScanResult> {
  const reminders = await listPendingReminders();
  let fired = 0;
  for (const reminder of reminders) {
    if (!reminderIsDue(reminder.dueAt, now)) continue;
    try {
      const claimed = await markReminderFired(reminder.id, new Date(now).toISOString());
      // Lost the race to another tick (or this row was cancelled between the
      // list and the claim) — never deliver on a row we didn't actually claim.
      if (!claimed) continue;
      await notifyEmployerOfReminder(reminder);
      fired++;
    } catch (e) {
      console.error("[reminder-cron] reminder failed", { reminderId: reminder.id, error: e });
    }
  }
  return { scanned: reminders.length, fired };
}
