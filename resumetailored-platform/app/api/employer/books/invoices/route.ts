import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBooks } from "@/lib/employer-plan";
import { listInvoices, createInvoice } from "@/lib/books-store";
import { sanitizeLineItems } from "@/lib/books-hub";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const invoices = await listInvoices(ctx.employerId);
  return NextResponse.json({ invoices });
}

/** POST — create a draft invoice. Body: { clientName, clientEmail?, issueDate, dueDate, lineItems }.
 *  Records + reminders only — no checkout, no payment link, no money movement. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { clientName?: string; clientEmail?: string; issueDate?: string; dueDate?: string; lineItems?: unknown };
  const clientName = String(body.clientName || "").trim().slice(0, 200);
  if (!clientName) return NextResponse.json({ error: "clientName is required." }, { status: 400 });
  const issueDate = String(body.issueDate || "").trim();
  const dueDate = String(body.dueDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return NextResponse.json({ error: "issueDate and dueDate must be YYYY-MM-DD." }, { status: 400 });
  }
  const lineItems = sanitizeLineItems(body.lineItems);
  if (!lineItems.length) return NextResponse.json({ error: "At least one line item is required." }, { status: 400 });

  const invoice = await createInvoice(ctx.employerId, ctx.userId, {
    clientName,
    clientEmail: body.clientEmail ? String(body.clientEmail).trim().slice(0, 300) : null,
    issueDate,
    dueDate,
    lineItems,
  });
  if (!invoice) return NextResponse.json({ error: "Could not save this invoice. Please try again." }, { status: 500 });
  return NextResponse.json({ invoice });
}
