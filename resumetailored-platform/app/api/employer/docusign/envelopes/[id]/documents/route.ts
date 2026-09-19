import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { getEnvelopeRecord, getValidAccessToken } from "@/lib/docusign-store";
import { getCombinedDocuments } from "@/lib/docusign";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Stream the completed, signed documents (combined into one PDF, with the
 * certificate of completion appended) for a signed/completed envelope.
 * Owner-scoped: the envelope must belong to the caller's employer.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const env = await getEnvelopeRecord(ctx.employerId, id);
  if (!env || !env.envelopeId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const access = await getValidAccessToken(ctx.employerId);
  if (!access) return NextResponse.json({ error: "not_connected" }, { status: 409 });

  const pdf = await getCombinedDocuments(
    { baseUri: access.baseUri, accountId: access.accountId, accessToken: access.accessToken },
    env.envelopeId
  );
  if (!pdf) return NextResponse.json({ error: "documents_unavailable" }, { status: 502 });

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="signed-documents-${id}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
