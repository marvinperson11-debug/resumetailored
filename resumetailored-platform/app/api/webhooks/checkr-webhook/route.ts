import { NextResponse } from "next/server";
import { parseCheckrWebhook } from "@/lib/checkr";
import { verifyCheckrSignature } from "@/lib/checkr-webhook-verify";
import { claimWebhookEvent } from "@/lib/webhook-idempotency";
import { applyCheckrReportUpdate, findOrderByCheckrId, markCandidateCompleted } from "@/lib/bgc-store";

export const runtime = "nodejs";

/**
 * Checkr webhook — report/invitation lifecycle events. Idempotent on the
 * event's own `id` via the shared webhook_events claim (Checkr retries on
 * a timeout or non-2xx, same as Twilio).
 */
export async function POST(req: Request) {
  const secret = process.env.CHECKR_WEBHOOK_SECRET || "";
  const raw = await req.text();
  const signature = req.headers.get("x-checkr-signature");
  if (!secret || !verifyCheckrSignature(raw, signature, secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const event = parseCheckrWebhook(raw);
  if (!event) return NextResponse.json({ error: "bad_payload" }, { status: 400 });

  const claim = await claimWebhookEvent("checkr", event.id);
  if (claim === "error") return NextResponse.json({ error: "store_unavailable" }, { status: 503 });
  if (claim === "duplicate") return NextResponse.json({ ok: true });

  const object = event.data.object as Record<string, unknown>;

  if (event.type.startsWith("report.")) {
    const reportId = (object.id as string) || "";
    const invitationId = (object.invitation_id as string) || undefined;
    const status = (object.status as string) || event.type.replace("report.", "");
    if (reportId) {
      await applyCheckrReportUpdate({ reportId, invitationId, checkrStatus: status, result: (object.result as string) || null });
    }
  } else if (event.type === "invitation.completed") {
    const invitationId = (object.id as string) || "";
    if (invitationId) {
      const order = await findOrderByCheckrId("checkr_invitation_id", invitationId);
      if (order) await markCandidateCompleted(order);
    }
  }

  return NextResponse.json({ ok: true });
}
