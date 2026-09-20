import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { listDocuments, createDocument } from "@/lib/documents-store";

export const runtime = "nodejs";

/** GET the employer's composed documents (newest first). */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const documents = await listDocuments(ctx.employerId);
  return NextResponse.json({ documents });
}

/** POST create a new document. Owner (or admin) only, like the other edits. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can create documents." }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as { title?: string; bodyHtml?: string };
  const title = (b.title || "").trim() || "Untitled document";
  const doc = await createDocument(ctx.employerId, { title, bodyHtml: b.bodyHtml || "" });
  if (!doc) return NextResponse.json({ error: "Could not create the document. Is the database configured?" }, { status: 500 });
  return NextResponse.json({ document: doc });
}
