import { NextResponse } from "next/server";
import { verifyWebhookSignature, parseWebhookPayload } from "@/lib/docusign";
import { updateStatusByEnvelopeId } from "@/lib/docusign-store";
import { deliverSignedDocuments } from "@/lib/esign-delivery";
import { markAckSignedByEnvelope } from "@/lib/training-store";

export const runtime = "nodejs";

/**
 * DocuSign Connect webhook. Validates the `X-DocuSign-Signature-1` HMAC header
 * against DOCUSIGN_WEBHOOK_SECRET (the shared secret configured in DocuSign
 * Connect), then syncs the envelope status. Fails closed when the secret is
 * unset — status still stays fresh via the fallback poll on the envelopes list.
 *
 * The raw request body must be read verbatim for the HMAC to match, so this
 * route reads `req.text()` and parses JSON itself.
 */
export async function POST(req: Request) {
  const secret = process.env.DOCUSIGN_WEBHOOK_SECRET || "";
  if (!secret) return NextResponse.json({ error: "webhook_not_configured" }, { status: 401 });

  const raw = await req.text();
  // DocuSign may send more than one HMAC header (key rotation). Accept any match.
  const sigHeaders = [
    req.headers.get("x-docusign-signature-1"),
    req.headers.get("x-docusign-signature-2"),
  ].filter(Boolean) as string[];
  const valid = sigHeaders.some((h) => verifyWebhookSignature(raw, h, secret));
  if (!valid) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }

  const parsed = parseWebhookPayload(body);
  if (parsed) {
    await updateStatusByEnvelopeId(parsed.envelopeId, parsed.status);
    // On completion, email the signer the signed documents + certificate, and
    // flip any training acknowledgment tied to this envelope to "signed". Both
    // fully best-effort (idempotent, never throw) so they can't block the update.
    if (parsed.status === "completed") {
      await deliverSignedDocuments(parsed.envelopeId);
      await markAckSignedByEnvelope(parsed.envelopeId);
    }
  }

  // Always 200 on a validated request so DocuSign doesn't retry unnecessarily.
  return NextResponse.json({ ok: true });
}
