import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { getDocument, updateDocument, deleteDocument } from "@/lib/documents-store";

export const runtime = "nodejs";

/** GET one document (owner-scoped). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const document = await getDocument(ctx.employerId, id);
  if (!document) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ document });
}

/** PUT update a document's title/body. Owner (or admin) only. */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can edit documents." }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { title?: string; bodyHtml?: string };
  const document = await updateDocument(ctx.employerId, id, { title: b.title, bodyHtml: b.bodyHtml });
  if (!document) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ document });
}

/** DELETE a document. Owner (or admin) only. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can delete documents." }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ok = await deleteDocument(ctx.employerId, id);
  return NextResponse.json({ ok });
}
