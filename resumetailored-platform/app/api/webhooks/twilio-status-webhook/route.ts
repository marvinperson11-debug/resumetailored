import { NextResponse } from "next/server";
import { verifyTwilioSignature, parseTwilioForm } from "@/lib/twilio";
import { claimWebhookEvent } from "@/lib/webhook-idempotency";
import { findMessageBySid, updateMessageStatus, type MessageStatus } from "@/lib/sms-store";

export const runtime = "nodejs";

/**
 * Twilio message-status callback. Dedupe key is `${MessageSid}:${Status}` —
 * not just the SID — because a genuine status PROGRESSION (queued -> sent
 * -> delivered) is three distinct, legitimate callbacks for the same
 * message; only a RETRY of the exact same status is a duplicate delivery.
 */
function mapTwilioStatus(status: string): MessageStatus | null {
  const s = status.toLowerCase();
  if (s === "queued" || s === "accepted") return "queued";
  if (s === "sending") return "sending";
  if (s === "sent") return "sent";
  if (s === "delivered") return "delivered";
  if (s === "failed" || s === "undelivered") return "failed";
  return null;
}

export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const raw = await req.text();
  const params = parseTwilioForm(raw);
  const signature = req.headers.get("x-twilio-signature");
  if (!authToken || !verifyTwilioSignature(req.url, params, signature, authToken)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const sid = params.MessageSid;
  const twilioStatus = params.MessageStatus || "";
  if (!sid || !twilioStatus) return NextResponse.json({ ok: true });

  const claim = await claimWebhookEvent("twilio_status", `${sid}:${twilioStatus}`);
  if (claim === "error") return NextResponse.json({ error: "store_unavailable" }, { status: 503 });
  if (claim === "duplicate") return NextResponse.json({ ok: true });

  const mapped = mapTwilioStatus(twilioStatus);
  if (mapped) {
    const message = await findMessageBySid(sid);
    if (message) {
      await updateMessageStatus(message.id, mapped, {
        failedReason: mapped === "failed" ? params.ErrorCode || "undelivered" : undefined,
        deliveredAt: mapped === "delivered" ? new Date().toISOString() : undefined,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
