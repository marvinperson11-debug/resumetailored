import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBooks, canUseFullBooks } from "@/lib/employer-plan";
import { getEntry, updateEntry, deleteEntry } from "@/lib/books-store";

export const dynamic = "force-dynamic";

/** PATCH — edit an existing entry. Body: any of { entryDate, amount, description, category, jobId }. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const existing = await getEntry(ctx.employerId, params.id);
  if (!existing) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { entryDate?: string; amount?: number; description?: string; category?: string; jobId?: number | null };
  const patch: { entryDate?: string; amountCents?: number; description?: string; category?: string; jobId?: number | null } = {};
  if (body.entryDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.entryDate)) return NextResponse.json({ error: "entryDate must be YYYY-MM-DD." }, { status: 400 });
    patch.entryDate = body.entryDate;
  }
  if (body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "amount must be a positive number." }, { status: 400 });
    patch.amountCents = Math.round(amount * 100);
  }
  if (body.description !== undefined) patch.description = String(body.description).trim().slice(0, 500);
  if (body.category !== undefined) patch.category = String(body.category).trim().slice(0, 80) || "uncategorized";
  if (body.jobId !== undefined) patch.jobId = canUseFullBooks(ctx.access) ? (body.jobId === null ? null : Number(body.jobId)) : existing.jobId;

  const ok = await updateEntry(ctx.employerId, params.id, patch);
  if (!ok) return NextResponse.json({ error: "Could not save this entry. Please try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const existing = await getEntry(ctx.employerId, params.id);
  if (!existing) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  const ok = await deleteEntry(ctx.employerId, params.id);
  return NextResponse.json({ ok });
}
