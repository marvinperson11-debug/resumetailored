import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EmployerTier } from "./employer-tier";
import { countSegments } from "./sms-phone";
import { isQuietHours, nextSendWindow } from "./sms-quiet-hours";
import { isOptedIn, isSuppressed } from "./sms-consent";
import { reserveSegments } from "./sms-quota";
import { getSmsNumber, getOrCreateConversation, listMessages, createMessage, type SmsMessage } from "./sms-store";
import { sendSmsViaTwilio } from "./twilio";
import { logAction } from "./assistant-audit";

/**
 * SMS send orchestration: the one place that ties consent, suppression,
 * quiet hours, and cap metering together before anything reaches Twilio.
 * Every candidate-facing action here is preceded by the caller's own UI
 * confirmation (the API route requires `confirm: true` in the request
 * body — see app/api/employer/sms/conversations/[id]/messages/route.ts)
 * and followed by an audit entry (lib/assistant-audit.ts, reusing the
 * existing append-only log rather than a new table).
 */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export interface ApplicantPhoneInfo {
  id: number;
  name: string;
  phoneNormalized: string | null;
}

export async function getApplicantPhoneInfo(applicantId: number): Promise<ApplicantPhoneInfo | null> {
  const c = db();
  if (!c || !Number.isFinite(applicantId)) return null;
  try {
    const { data, error } = await c.from("applicants").select("id, name, phone_normalized").eq("id", applicantId).maybeSingle();
    if (error || !data) return null;
    return { id: data.id as number, name: (data.name as string) || "", phoneNormalized: (data.phone_normalized as string) || null };
  } catch {
    return null;
  }
}

export type SendDeniedReason = "no_phone" | "no_consent" | "suppressed" | "no_number" | "send_failed";

export interface SendCandidateSmsResult {
  ok: boolean;
  deniedReason?: SendDeniedReason;
  queued?: boolean;
  queueReason?: "cap" | "quiet_hours";
  message?: SmsMessage;
}

export async function sendCandidateSms(v: {
  employerId: string;
  tier: EmployerTier;
  employerDisplayName: string;
  actorUserId: string;
  actorEmail?: string | null;
  applicantId: number;
  body: string;
  now?: Date;
}): Promise<SendCandidateSmsResult> {
  const now = v.now || new Date();
  const applicant = await getApplicantPhoneInfo(v.applicantId);
  if (!applicant?.phoneNormalized) return { ok: false, deniedReason: "no_phone" };

  const [suppressed, optedIn, number] = await Promise.all([isSuppressed(applicant.phoneNormalized), isOptedIn(v.applicantId), getSmsNumber(v.employerId)]);
  if (suppressed) return { ok: false, deniedReason: "suppressed" };
  if (!optedIn) return { ok: false, deniedReason: "no_consent" };
  if (!number || number.status !== "active") return { ok: false, deniedReason: "no_number" };

  const conversation = await getOrCreateConversation(v.employerId, v.applicantId, applicant.phoneNormalized);
  if (!conversation) return { ok: false, deniedReason: "send_failed" };

  const priorOutbound = await listMessages(conversation.id);
  const isFirstOutbound = !priorOutbound.some((m) => m.direction === "outbound" && (m.status === "sent" || m.status === "delivered"));
  const finalBody = isFirstOutbound ? `${v.employerDisplayName}: ${v.body}\n\nReply STOP to opt out.` : v.body;
  const { segments } = countSegments(finalBody);

  if (isQuietHours(applicant.phoneNormalized, now)) {
    const scheduledAt = nextSendWindow(applicant.phoneNormalized, now).toISOString();
    const message = await createMessage({
      conversationId: conversation.id,
      employerId: v.employerId,
      direction: "outbound",
      body: finalBody,
      segments,
      status: "queued",
      queueReason: "quiet_hours",
      actorUserId: v.actorUserId,
      scheduledAt,
    });
    return { ok: true, queued: true, queueReason: "quiet_hours", message: message || undefined };
  }

  const reservation = await reserveSegments(v.employerId, v.tier, segments, now);
  if (!reservation.reserved) {
    const message = await createMessage({
      conversationId: conversation.id,
      employerId: v.employerId,
      direction: "outbound",
      body: finalBody,
      segments,
      status: "queued",
      queueReason: "cap",
      actorUserId: v.actorUserId,
    });
    await logAction({ employerId: v.employerId, actorUserId: v.actorUserId, actorEmail: v.actorEmail, action: "sms.cap_warning", targetType: "sms_conversation", targetId: conversation.id, payload: { segments, capStatus: reservation.status }, status: "executed" });
    return { ok: true, queued: true, queueReason: "cap", message: message || undefined };
  }

  const twilioResult = await sendSmsViaTwilio({ from: number.phoneNumber, to: applicant.phoneNormalized, body: finalBody });
  if (!twilioResult.ok) {
    const message = await createMessage({
      conversationId: conversation.id,
      employerId: v.employerId,
      direction: "outbound",
      body: finalBody,
      segments,
      status: "failed",
      actorUserId: v.actorUserId,
    });
    await logAction({ employerId: v.employerId, actorUserId: v.actorUserId, actorEmail: v.actorEmail, action: "sms.sent", targetType: "sms_conversation", targetId: conversation.id, payload: { segments, ok: false, error: twilioResult.errorMessage }, status: "failed" });
    return { ok: false, deniedReason: "send_failed", message: message || undefined };
  }

  const message = await createMessage({
    conversationId: conversation.id,
    employerId: v.employerId,
    direction: "outbound",
    body: finalBody,
    segments,
    status: "sent",
    providerMessageSid: twilioResult.sid || null,
    actorUserId: v.actorUserId,
  });
  await logAction({ employerId: v.employerId, actorUserId: v.actorUserId, actorEmail: v.actorEmail, action: "sms.sent", targetType: "sms_conversation", targetId: conversation.id, payload: { segments, sid: twilioResult.sid }, status: "executed" });
  return { ok: true, queued: false, message: message || undefined };
}
