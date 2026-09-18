import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { addRequestedDocs, getEnvelopeByEnvelopeId } from "@/lib/docusign-store";
import { notifySignerOfDocRequest } from "@/lib/esign-delivery";

export const runtime = "nodejs";

/**
 * Add document requests to an already-sent envelope (feature C7). Appends the
 * named upload slots and — when `notify` is set — emails the signer a fresh
 * upload link with the newly-added requests. Owner-scoped.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { names?: string[]; notify?: boolean };
  const names = Array.from(
    new Set((Array.isArray(b.names) ? b.names : []).map((n) => String(n || "").trim()).filter(Boolean))
  ).slice(0, 20);
  if (!names.length) return NextResponse.json({ error: "Add at least one document to request." }, { status: 400 });

  const updated = await addRequestedDocs(ctx.employerId, id, names);
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Only the names that are actually new (present after, matching our input).
  const added = names.filter((n) => updated.requestedDocs.some((d) => d.name.trim().toLowerCase() === n.toLowerCase()));

  if (b.notify !== false && added.length) {
    const lookup = await getEnvelopeByEnvelopeId(updated.envelopeId);
    if (lookup) void notifySignerOfDocRequest(lookup, added);
  }

  return NextResponse.json({ envelope: updated });
}
