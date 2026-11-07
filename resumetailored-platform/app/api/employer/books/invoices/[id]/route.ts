import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBooks } from "@/lib/employer-plan";
import { getInvoice, setInvoiceStatus } from "@/lib/books-store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const invoice = await getInvoice(ctx.employerId, params.id);
  if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  return NextResponse.json({ invoice });
}

/** PATCH — status transitions that don't send email: mark paid, or void.
 *  Body: { status: "paid" | "void" }. Sending/reminding have their own
 *  routes (send/remind) since those trigger an email. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const invoice = await getInvoice(ctx.employerId, params.id);
  if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { status?: string };
  if (body.status !== "paid" && body.status !== "void") return NextResponse.json({ error: "status must be 'paid' or 'void'." }, { status: 400 });

  const ok = await setInvoiceStatus(ctx.employerId, params.id, body.status, body.status === "paid" ? { paidAt: new Date().toISOString() } : {});
  if (!ok) return NextResponse.json({ error: "Could not update this invoice. Please try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
