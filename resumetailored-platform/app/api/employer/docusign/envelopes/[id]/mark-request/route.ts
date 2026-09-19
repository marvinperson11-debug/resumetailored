import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { markRequestSatisfied } from "@/lib/docusign-store";

export const runtime = "nodejs";

/**
 * Manually mark a requested-document slot as satisfied — optionally linking an
 * existing attachment (by its storage path) as the fulfilling file. Lets an
 * employer clear a "still missing" slot when the signer uploaded the right file
 * to the free-form area instead of the named slot. Owner-scoped.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { name?: string; attachmentUrl?: string };
  const name = String(b.name || "").trim();
  if (!name) return NextResponse.json({ error: "Which request?" }, { status: 400 });
  const attachmentUrl = b.attachmentUrl ? String(b.attachmentUrl) : undefined;

  const updated = await markRequestSatisfied(ctx.employerId, id, name, attachmentUrl);
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ envelope: updated });
}
