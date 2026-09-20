import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { listEnvelopesForEmail } from "@/lib/docusign-store";

export const runtime = "nodejs";

/**
 * The employee's "My documents": every DocuSign envelope where they are the
 * signer (offers, agreements, write-ups, custom documents), matched on their
 * email and scoped to their employer. These are stored on BOTH sides — the
 * employer sees them in E-Signatures, the employee sees them here automatically.
 * Each envelope carries its attachments (files uploaded for/by them) for
 * view/download.
 */
export async function GET() {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!ctx.employee.email) return NextResponse.json({ documents: [] });

  const envelopes = await listEnvelopesForEmail(ctx.employerId, ctx.employee.email);
  const documents = envelopes.map((e) => ({
    id: e.id,
    docType: e.docType,
    documentName: e.documentName || e.subject || "Document",
    subject: e.subject,
    status: e.status,
    sentAt: e.sentAt,
    completedAt: e.completedAt,
    // Only surface attachments that have a fetchable URL; hide employer-internal
    // signer tokens etc.
    attachments: e.attachments
      .filter((a) => a.url)
      .map((a) => ({ name: a.name, url: a.url, by: a.by, uploadedAt: a.uploadedAt })),
  }));

  return NextResponse.json({ documents });
}
