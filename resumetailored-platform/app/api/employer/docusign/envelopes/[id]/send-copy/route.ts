import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { getEnvelopeRecord, getValidAccessToken, appendCopySent } from "@/lib/docusign-store";
import { getCombinedDocuments } from "@/lib/docusign";
import { sendSignedCopy } from "@/lib/esign-delivery";
import { DOC_TYPE_LABELS } from "@/lib/employer-ai";

export const runtime = "nodejs";
export const maxDuration = 30;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Send a copy (forward) of a completed envelope's combined signed PDF +
 * certificate to any name/email via Resend — a plain forward, no DocuSign step,
 * no signature required from the recipient. Records a copy-sent log entry.
 * Owner-scoped.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { name?: string; email?: string };
  const name = String(b.name || "").trim().slice(0, 120);
  const email = String(b.email || "").trim().slice(0, 200);
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  const env = await getEnvelopeRecord(ctx.employerId, id);
  if (!env || !env.envelopeId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (env.status !== "completed" && env.status !== "signed") {
    return NextResponse.json({ error: "This document isn't complete yet." }, { status: 400 });
  }

  const access = await getValidAccessToken(ctx.employerId);
  if (!access) return NextResponse.json({ error: "not_connected" }, { status: 409 });

  const pdf = await getCombinedDocuments(
    { baseUri: access.baseUri, accountId: access.accountId, accessToken: access.accessToken },
    env.envelopeId
  );
  if (!pdf) return NextResponse.json({ error: "Couldn't fetch the signed documents. Please try again." }, { status: 502 });

  const documentLabel = env.documentName || env.offer.position || DOC_TYPE_LABELS[env.docType];
  const ok = await sendSignedCopy({
    employerId: ctx.employerId,
    toName: name,
    toEmail: email,
    documentLabel,
    signerName: env.candidateName,
    pdf,
  });
  if (!ok) {
    return NextResponse.json({ error: "Couldn't send the copy. Email isn't configured or the send failed." }, { status: 502 });
  }

  const envelope = await appendCopySent(ctx.employerId, id, { name, email });
  return NextResponse.json({ ok: true, envelope });
}
