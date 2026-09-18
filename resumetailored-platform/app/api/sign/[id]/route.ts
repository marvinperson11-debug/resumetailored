import { NextResponse, type NextRequest } from "next/server";
import { getEnvelopeBySignToken } from "@/lib/docusign-store";
import { getEmployerProfile } from "@/lib/employer-store";
import { ENVELOPE_ATTACH_EXT, MAX_ENVELOPE_ATTACH_BYTES } from "@/lib/docusign-store";

export const runtime = "nodejs";

/**
 * Login-less signer view of an envelope's upload page. Authenticated ONLY by the
 * per-envelope `key` token (in the link) matched against the DocuSign envelope
 * id in the path — no session. Returns just what the signer needs to render
 * their upload slots; never a storage path, employer id, or other signers' data.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const token = req.nextUrl.searchParams.get("key") || "";
  const env = await getEnvelopeBySignToken(params.id, token);
  if (!env) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const profile = await getEmployerProfile(env.employerId).catch(() => null);

  return NextResponse.json({
    ok: true,
    signerName: env.candidateName,
    documentName: env.documentName || env.subject || "your document",
    company: profile?.companyName || "",
    status: env.status,
    completed: env.status === "completed",
    requestedDocs: env.requestedDocs.map((d) => ({ name: d.name, uploaded: d.uploaded })),
    // The signer only sees files they uploaded — never employer-attached files.
    uploaded: env.attachments
      .filter((a) => a.by !== "employer")
      .map((a) => ({ name: a.name, note: a.note, uploadedAt: a.uploadedAt, kind: a.kind })),
    limits: {
      maxBytes: MAX_ENVELOPE_ATTACH_BYTES,
      allowedExt: Object.keys(ENVELOPE_ATTACH_EXT),
    },
  });
}
