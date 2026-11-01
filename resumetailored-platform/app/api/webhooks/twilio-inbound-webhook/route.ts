import { NextResponse } from "next/server";
import { verifyTwilioSignature, parseTwilioForm } from "@/lib/twilio";
import { claimWebhookEvent } from "@/lib/webhook-idempotency";
import { normalizePhoneE164 } from "@/lib/sms-phone";
import { classifyKeyword, recordOptOut, recordOptIn } from "@/lib/sms-consent";
import { employerIdForNumber, getOrCreateConversation, createMessage } from "@/lib/sms-store";
import { findApplicantIdByPhone } from "@/lib/employer-store";
import { logAction } from "@/lib/assistant-audit";

export const runtime = "nodejs";

/**
 * Twilio inbound-SMS webhook — every text a candidate sends to any org's
 * number lands here first. Handles the Advanced Opt-Out keywords
 * (STOP/START/HELP and their synonyms) before anything else, since those
 * apply GLOBALLY regardless of which org's number received them; an
 * ordinary reply is routed to that org's conversation with the candidate
 * whose phone number matches, if one can be found.
 *
 * Twilio retries a webhook that doesn't answer quickly/2xx, so this is
 * idempotent on MessageSid via the shared webhook_events claim.
 */
export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const raw = await req.text();
  const params = parseTwilioForm(raw);
  const signature = req.headers.get("x-twilio-signature");
  if (!authToken || !verifyTwilioSignature(req.url, params, signature, authToken)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const sid = params.MessageSid;
  if (!sid) return new NextResponse("", { status: 200, headers: { "Content-Type": "text/xml" } });
  const claim = await claimWebhookEvent("twilio_inbound", sid);
  if (claim === "error") return NextResponse.json({ error: "store_unavailable" }, { status: 503 });
  if (claim === "duplicate") return new NextResponse("", { status: 200, headers: { "Content-Type": "text/xml" } });

  const fromE164 = normalizePhoneE164(params.From);
  const toE164 = normalizePhoneE164(params.To);
  const body = params.Body || "";
  const keyword = classifyKeyword(body);

  if (fromE164 && keyword === "stop") {
    await recordOptOut(fromE164, "stop_keyword");
    const employerId = toE164 ? await employerIdForNumber(toE164) : null;
    if (employerId) await logAction({ employerId, actorUserId: "candidate", action: "sms.opt_out", targetType: "phone", targetId: fromE164, payload: { keyword: body.trim() }, status: "executed" });
  } else if (fromE164 && keyword === "start") {
    await recordOptIn(fromE164);
    const employerId = toE164 ? await employerIdForNumber(toE164) : null;
    if (employerId) await logAction({ employerId, actorUserId: "candidate", action: "sms.opt_in", targetType: "phone", targetId: fromE164, payload: { keyword: body.trim() }, status: "executed" });
  } else if (fromE164 && toE164 && keyword !== "help") {
    const employerId = await employerIdForNumber(toE164);
    if (employerId) {
      const applicantId = await findApplicantIdByPhone(employerId, fromE164);
      if (applicantId) {
        const conversation = await getOrCreateConversation(employerId, applicantId, fromE164);
        if (conversation) {
          await createMessage({ conversationId: conversation.id, employerId, direction: "inbound", body, segments: 1, status: "received", providerMessageSid: sid });
        }
      }
    }
  }

  // Empty TwiML: no auto-reply body. Twilio's own STOP/START confirmation
  // SMS (configured in the Twilio console's Advanced Opt-Out settings)
  // handles the candidate-facing acknowledgment, not this response.
  return new NextResponse("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
}
