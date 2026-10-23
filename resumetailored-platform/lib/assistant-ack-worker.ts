import { getActiveAckSetting } from "./assistant-ack-settings";
import { listApplicantsNeedingAck, markApplicantAckSent, getApplicant, getEmployerProfile } from "./employer-store";
import { sendMessage, hasInterviewOptout } from "./employer-collab-store";
import { sendEmail, resolveUserEmail, emailShell } from "./email";
import { employerSignatureHtml } from "./employer-signature";
import { ackEmailParts, renderAckEmailHtml } from "./assistant-ack-render";
import { logAction } from "./assistant-audit";

/**
 * Auto-application-acknowledgment worker (Employer Portal AI Assistant,
 * Prompt 4). Ticked from instrumentation.ts's existing 15s loop, alongside
 * lib/assistant-send-worker.ts. Zero LLM calls — the body is the exact
 * approved template (lib/assistant-ack-settings.ts), personalized only by a
 * literal `{{firstName}}`/`{{name}}` substring replace, same convention as
 * lib/assistant-mutations.ts `personalize`.
 *
 * DELIBERATELY self-contained email, same reasoning as
 * lib/assistant-send-worker.ts's own header comment: this file is reachable
 * from instrumentation.ts, which Next also tries to compile for the EDGE
 * runtime, and lib/employer-notify.ts's shared context() helper reaches
 * lib/docusign.ts -> Node's `crypto`, which breaks that edge compile.
 * `sendMessage` itself (the real send) comes from
 * lib/employer-collab-store.ts, the same function the hand-driven Messages
 * route and lib/assistant-send-worker.ts both call — only the notification
 * EMAIL is reimplemented here.
 */

const ACK_LOOKBACK_HOURS = 48;

function personalize(body: string, name: string): string {
  const firstName = (name || "there").split(" ")[0] || "there";
  return body.replace(/\{\{\s*firstName\s*\}\}/gi, firstName).replace(/\{\{\s*name\s*\}\}/gi, name || "there");
}

async function notifyCandidateOfAck(employerId: string, applicantId: number, body: string): Promise<void> {
  const applicant = await getApplicant(employerId, applicantId);
  if (!applicant?.email) return;
  const profile = await getEmployerProfile(employerId);
  const replyTo = (await resolveUserEmail(employerId)) || undefined;
  const fromName = profile?.companyName || undefined;
  const signature = await employerSignatureHtml(employerId);
  const firstName = (applicant.name || "there").split(" ")[0] || applicant.name || "there";
  // Same renderer the confirmation card previews (lib/assistant-ack-render.ts)
  // — the card the employer approved and this email are guaranteed to match.
  const parts = ackEmailParts(firstName, body, profile?.companyName || "");

  await sendEmail({
    to: applicant.email,
    replyTo,
    fromName,
    subject: `A message from ${profile?.companyName || "the employer"}`,
    html: emailShell(renderAckEmailHtml(parts), signature),
  });
}

export interface AckScanResult {
  scanned: number;
  sent: number;
}

/** Ticked every 15 seconds. For every applicant created in the last
 *  `ACK_LOOKBACK_HOURS` with no acknowledgment sent yet, resolves the
 *  matching standing template (job-specific beats account-wide), sends it
 *  VERBATIM (personalized only by a literal placeholder replace), and
 *  stamps `ack_sent_at` so the same applicant is never acknowledged twice —
 *  even across overlapping ticks, since the stamp happens immediately after
 *  the send succeeds and the next tick's query only ever sees
 *  `ack_sent_at is null` rows. An applicant with no matching template simply
 *  stays unacknowledged (not an error) and is reconsidered on a later tick —
 *  configuring a template retroactively still catches it within the lookback
 *  window. */
export async function runAssistantAckScan(now: number = Date.now()): Promise<AckScanResult> {
  const sinceIso = new Date(now - ACK_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const candidates = await listApplicantsNeedingAck(sinceIso);
  let scanned = 0;
  let sent = 0;

  for (const a of candidates) {
    scanned++;
    try {
      const setting = await getActiveAckSetting(a.employerId, a.jobId);
      if (!setting || !setting.enabled) continue;
      // No send worker scans unbounded history with a null sentinel; every
      // scan is bounded by the setting that authorizes the send. An
      // applicant who applied BEFORE this template was approved is never
      // acknowledged retroactively just because ack_sent_at happens to be
      // null (the Oct 23 incident: a pre-template applicant got an email
      // the first time a template was ever turned on), and a candidate who
      // opted out — at the applicant level or on any of their own
      // interviews — is never sent to, no matter how new.
      if (new Date(a.createdAt).getTime() < new Date(setting.createdAt).getTime()) continue;
      if (a.candidateCommsOptout) continue;
      if (await hasInterviewOptout(a.id)) continue;
      const body = personalize(setting.template, a.name);
      const message = await sendMessage(a.employerId, a.id, body, []);
      if (!message) continue;
      await markApplicantAckSent(a.id, new Date(now).toISOString());
      await notifyCandidateOfAck(a.employerId, a.id, body).catch(() => {});
      await logAction({
        employerId: a.employerId,
        actorUserId: setting.actorUserId,
        actorEmail: setting.actorEmail,
        action: "auto_ack",
        targetType: "candidate",
        targetId: a.id,
        payload: { template: setting.template, jobScoped: setting.jobId !== null },
        status: "executed",
      });
      sent++;
    } catch (e) {
      console.error("[assistant-ack-worker] applicant failed", { applicantId: a.id, error: e });
    }
  }

  return { scanned, sent };
}
