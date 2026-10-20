import { listDueQueued, markSent, markFailed } from "./assistant-send-queue";
import { getPendingActionById } from "./assistant-pending";
import { sendMessage } from "./employer-collab-store";
import { getApplicant, getEmployerProfile } from "./employer-store";
import { sendEmail, resolveUserEmail, escapeHtml, emailShell } from "./email";
import { employerSignatureHtml } from "./employer-signature";

/**
 * Sends candidate messages the Assistant queued after an employer's approval,
 * once their undo window has passed (lib/assistant-mutations.ts enqueues via
 * lib/assistant-send-queue.ts; the employer-facing Undo button cancels a
 * still-queued row before this runs). Ticked from instrumentation.ts.
 *
 * Worker authorization: a row only ever reaches here because a human already
 * approved the pending action that created it — `executePendingAction`
 * (lib/assistant-mutations.ts) only enqueues on approval, and this scan
 * double-checks that action's status is still 'executed' before sending. The
 * undo window is a timing safety valve, not a second approval gate: approval
 * IS the authorization event, so re-verifying it here (rather than asking
 * anyone again) is intentional, and `logAction` is not called a second time
 * for the mechanical send itself — the decision was already audited at
 * approval (see approvePendingAction).
 *
 * DELIBERATELY self-contained email, same reasoning as
 * lib/interview-reminders.ts: this file is reachable from instrumentation.ts,
 * which Next also tries to compile for the EDGE runtime, and
 * lib/employer-notify.ts's shared context() helper reaches
 * lib/docusign.ts -> Node's `crypto`, which breaks that edge compile. Keeping
 * this file's import graph to employer-store.ts/email.ts/employer-signature.ts
 * (none of which touch docusign.ts) is what keeps `npm run build` green —
 * pulling in employer-notify.ts here would reintroduce that exact failure.
 * `sendMessage` itself (the real send, body bytes preserved exactly) comes
 * from lib/employer-collab-store.ts, the same function the hand-driven
 * Messages route calls — only the notification EMAIL is reimplemented here.
 */
async function notifyCandidateOfQueuedMessage(employerId: string, applicantId: number, body: string): Promise<void> {
  const applicant = await getApplicant(employerId, applicantId);
  if (!applicant?.email) return;
  const profile = await getEmployerProfile(employerId);
  const replyTo = (await resolveUserEmail(employerId)) || undefined;
  const fromName = profile?.companyName || undefined;
  const signature = await employerSignatureHtml(employerId);
  const company = escapeHtml(profile?.companyName || "the employer");
  const firstName = escapeHtml((applicant.name || "there").split(" ")[0] || applicant.name || "there");

  await sendEmail({
    to: applicant.email,
    replyTo,
    fromName,
    subject: `A message from ${profile?.companyName || "the employer"}`,
    html: emailShell(
      `<p>Hi ${firstName},</p>
<p>${escapeHtml(body).replace(/\n/g, "<br/>")}</p>
<p style="font-size:13px;color:#666">— ${company}</p>`,
      signature
    ),
  });
}

/** Scan every employer's due send-queue rows and send what's still valid.
 *  Safe to run as often as desired — idempotent in the sense that a row is
 *  only ever picked up while `status = 'queued'`, and the first thing this
 *  does with it is flip that status away from 'queued'. */
export async function runAssistantSendQueueScan(now: number = Date.now()): Promise<{ scanned: number; sent: number; failed: number }> {
  const due = await listDueQueued(now);
  let sent = 0;
  let failed = 0;
  for (const row of due) {
    try {
      const pending = await getPendingActionById(row.pendingActionId);
      if (!pending || pending.status !== "executed") {
        await markFailed(row.id, "approval_no_longer_valid");
        failed++;
        continue;
      }
      const applicant = await getApplicant(row.employerId, row.candidateId);
      if (!applicant) {
        await markFailed(row.id, "candidate_unavailable");
        failed++;
        continue;
      }
      const message = await sendMessage(row.employerId, row.candidateId, row.body, []);
      if (!message) {
        await markFailed(row.id, "send_failed");
        failed++;
        continue;
      }
      await notifyCandidateOfQueuedMessage(row.employerId, row.candidateId, row.body).catch(() => {});
      await markSent(row.id);
      sent++;
    } catch (e) {
      console.error("[assistant-send-worker] row failed", { id: row.id, error: e });
      await markFailed(row.id, "unexpected_error");
      failed++;
    }
  }
  return { scanned: due.length, sent, failed };
}
