/**
 * Releases queued SMS (lib/sms-send.ts queues on quiet-hours OR a cap hit).
 * Re-checks everything at flush time rather than trusting the original
 * queue reason still holds — suppression/consent can change between queue
 * and flush, and a cap-queued message needs ITS OWN cap check here because
 * `sendCandidateSms` never reserved for it in the first place.
 *
 * Two callers: the in-process 30-minute scan (instrumentation.ts,
 * `runSmsQueueFlushScan`) catches quiet-hours messages once their window
 * opens, and `flushQueuedForEmployer` is called directly by the overage
 * purchase route so "restores sending immediately" is actually immediate
 * rather than waiting for the next tick.
 */
import { resolveTierForUserId } from "./employer-plan";
import { isQuietHours } from "./sms-quiet-hours";
import { isOptedIn, isSuppressed } from "./sms-consent";
import { reserveSegments } from "./sms-quota";
import { getSmsNumber, getConversation, listQueuedMessages, updateMessageStatus, type SmsMessage } from "./sms-store";
import { sendSmsViaTwilio } from "./twilio";
import { logAction } from "./assistant-audit";

type FlushOutcome = "sent" | "still_quiet" | "still_capped" | "denied" | "send_failed";

async function attemptFlushOne(message: SmsMessage, now: Date): Promise<FlushOutcome> {
  const conversation = await getConversation(message.employerId, message.conversationId);
  if (!conversation) return "denied";

  const [suppressed, optedIn, number] = await Promise.all([
    isSuppressed(conversation.phoneNormalized),
    isOptedIn(conversation.applicantId),
    getSmsNumber(message.employerId),
  ]);
  if (suppressed || !optedIn || !number || number.status !== "active") {
    await updateMessageStatus(message.id, "failed", { failedReason: suppressed ? "suppressed" : !optedIn ? "no_consent" : "no_number" });
    return "denied";
  }

  if (isQuietHours(conversation.phoneNormalized, now)) {
    return "still_quiet"; // scheduled_at is already set; left as-is for the next tick
  }

  const tier = await resolveTierForUserId(message.employerId);
  const reservation = await reserveSegments(message.employerId, tier, message.segments, now);
  if (!reservation.reserved) return "still_capped";

  const result = await sendSmsViaTwilio({ from: number.phoneNumber, to: conversation.phoneNormalized, body: message.body });
  if (!result.ok) {
    await updateMessageStatus(message.id, "failed", { failedReason: result.errorMessage });
    await logAction({ employerId: message.employerId, actorUserId: message.actorUserId || "system", action: "sms.sent", targetType: "sms_conversation", targetId: conversation.id, payload: { ok: false, flushed: true, error: result.errorMessage }, status: "failed" });
    return "send_failed";
  }

  await updateMessageStatus(message.id, "sent");
  await logAction({ employerId: message.employerId, actorUserId: message.actorUserId || "system", action: "sms.sent", targetType: "sms_conversation", targetId: conversation.id, payload: { flushed: true, sid: result.sid }, status: "executed" });
  return "sent";
}

export interface FlushScanResult {
  scanned: number;
  sent: number;
  stillQueued: number;
  denied: number;
}

export async function runSmsQueueFlushScan(now = new Date()): Promise<FlushScanResult> {
  const queued = await listQueuedMessages();
  const result: FlushScanResult = { scanned: queued.length, sent: 0, stillQueued: 0, denied: 0 };
  for (const message of queued) {
    try {
      const outcome = await attemptFlushOne(message, now);
      if (outcome === "sent") result.sent++;
      else if (outcome === "still_quiet" || outcome === "still_capped") result.stillQueued++;
      else result.denied++;
    } catch (e) {
      console.error("[sms-queue-flush] attemptFlushOne threw", { messageId: message.id, error: e });
      result.denied++;
    }
  }
  return result;
}

/** Flush only one org's queue — used right after an overage purchase. */
export async function flushQueuedForEmployer(employerId: string, now = new Date()): Promise<FlushScanResult> {
  const queued = (await listQueuedMessages()).filter((m) => m.employerId === employerId);
  const result: FlushScanResult = { scanned: queued.length, sent: 0, stillQueued: 0, denied: 0 };
  for (const message of queued) {
    try {
      const outcome = await attemptFlushOne(message, now);
      if (outcome === "sent") result.sent++;
      else if (outcome === "still_quiet" || outcome === "still_capped") result.stillQueued++;
      else result.denied++;
    } catch (e) {
      console.error("[sms-queue-flush] attemptFlushOne threw", { messageId: message.id, error: e });
      result.denied++;
    }
  }
  return result;
}
