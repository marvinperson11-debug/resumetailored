import { NextResponse, type NextRequest } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { getEnvelopeLookupOwned, downloadEnvelopeAttachment } from "@/lib/docusign-store";

export const runtime = "nodejs";

/**
 * Stream one envelope attachment to the employer who owns it. Owner-scoped two
 * ways: the envelope must belong to the caller's employer, AND the requested
 * storage path must be one of that envelope's recorded attachment paths (so a
 * path can't be forged to reach another envelope's files). Never a public URL.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const path = req.nextUrl.searchParams.get("path") || "";
  const env = await getEnvelopeLookupOwned(ctx.employerId, id);
  if (!env) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const attachment = env.attachments.find((a) => a.url === path);
  if (!attachment) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const file = await downloadEnvelopeAttachment(ctx.employerId, path);
  if (!file) return NextResponse.json({ error: "unavailable" }, { status: 502 });

  const dl = req.nextUrl.searchParams.get("download") === "1";
  const safeName = (attachment.name || "attachment").replace(/[^\w.\-]+/g, "_");
  return new NextResponse(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `${dl ? "attachment" : "inline"}; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
