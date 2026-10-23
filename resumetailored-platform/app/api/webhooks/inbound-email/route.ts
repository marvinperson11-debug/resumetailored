import { NextResponse } from "next/server";
import { parseInboundPayload, processInboundReschedule, claimResendDelivery, recordResendFetchFailure } from "@/lib/assistant-inbound";
import { readSvixHeaders, verifySvixSignature, isStaleSvixTimestamp, parseResendEnvelope, fetchResendReceivedEmail, stripQuotedReply } from "@/lib/assistant-resend-inbound";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Inbound-email webhook for the reply-by-email interview reschedule flow
 * (Employer Portal AI Assistant — Prompt 3, Resend adapter added in Prompt
 * 4). Two auth paths, picked by whether the delivery carries Svix headers:
 *
 *  - Svix-signed (Resend): `svix-id`/`svix-timestamp`/`svix-signature`
 *    present → verified against `RESEND_WEBHOOK_SIGNING_SECRET` (HMAC per
 *    the Svix spec) with a 5-minute timestamp-skew check, then the body —
 *    metadata only, `{type:"email.received", data:{email_id,...}}` — is
 *    used to fetch the full message from Resend's own API by `email_id`
 *    (lib/assistant-resend-inbound.ts) and mapped into the same shape the
 *    legacy path has always produced.
 *  - Legacy shared-secret (any other provider, or Resend before its signing
 *    secret is configured): unchanged from Prompt 3 — a single
 *    `x-inbound-webhook-secret` header checked against
 *    `INBOUND_WEBHOOK_SECRET`, body read directly via
 *    `parseInboundPayload`'s field-name sniffing.
 *
 * Unset `INBOUND_WEBHOOK_SECRET` (legacy path) means that whole path is off
 * and answers 404 rather than 401 — no information disclosed about whether
 * the feature is configurable at all. The Svix path has its own, independent
 * "is this configured" gate (`RESEND_WEBHOOK_SIGNING_SECRET`), since a
 * deployment may run Resend without ever having set up the legacy secret.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const svixHeaders = readSvixHeaders(req.headers);

  if (svixHeaders) {
    const signingSecret = process.env.RESEND_WEBHOOK_SIGNING_SECRET;
    if (!signingSecret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (isStaleSvixTimestamp(svixHeaders.timestamp)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!verifySvixSignature(signingSecret, svixHeaders, rawBody)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = (() => {
      try {
        return JSON.parse(rawBody);
      } catch {
        return null;
      }
    })();
    const envelope = parseResendEnvelope(body);
    if (!envelope) return NextResponse.json({ error: "bad_payload" }, { status: 400 });

    // Pre-claim BEFORE fetching the body: a retried delivery is recognized
    // as a duplicate without ever spending a Resend API call or an LLM
    // classification call on it. "error" (the claim itself failed, for a
    // reason OTHER than a genuine unique violation) must never be answered
    // as 200 duplicate — that would hide a real failure as a successful
    // dedupe, so it's a 500 instead.
    const claimed = await claimResendDelivery(envelope.emailId);
    if (claimed === "duplicate") return NextResponse.json({ ok: true, outcome: "duplicate" });
    if (claimed === "error") return NextResponse.json({ error: "server_error" }, { status: 500 });

    const email = await fetchResendReceivedEmail(envelope.emailId);
    if (!email) {
      await recordResendFetchFailure(envelope.emailId);
      return NextResponse.json({ ok: true, outcome: "unknown" });
    }

    const result = await processInboundReschedule(
      {
        from: email.from,
        subject: email.subject,
        text: stripQuotedReply(email.text),
        originalTo: email.to,
        providerMessageId: envelope.emailId,
      },
      { column: "resend_email_id", value: envelope.emailId },
      { claimed: true }
    );
    if (result.outcome === "invalid_token") return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (result.outcome === "error") return NextResponse.json({ error: "server_error" }, { status: 500 });
    return NextResponse.json({ ok: true, outcome: result.outcome });
  }

  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const header = req.headers.get("x-inbound-webhook-secret") || "";
  if (header !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (() => {
    try {
      return JSON.parse(rawBody);
    } catch {
      return null;
    }
  })();
  const payload = parseInboundPayload(body);
  if (!payload) return NextResponse.json({ error: "bad_payload" }, { status: 400 });

  const result = await processInboundReschedule(payload);
  if (result.outcome === "invalid_token") {
    // Token lookup failure (unknown/expired/tampered) discloses nothing —
    // same 404 shape as the route being unconfigured.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (result.outcome === "error") return NextResponse.json({ error: "server_error" }, { status: 500 });
  return NextResponse.json({ ok: true, outcome: result.outcome });
}
