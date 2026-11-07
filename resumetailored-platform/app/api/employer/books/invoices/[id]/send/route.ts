import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBooks } from "@/lib/employer-plan";
import { getInvoice, setInvoiceStatus } from "@/lib/books-store";
import { getEmployerProfile } from "@/lib/employer-store";
import { sendEmail, emailShell, escapeHtml, resolveUserEmail } from "@/lib/email";
import { formatMoney } from "@/lib/books-hub";

export const dynamic = "force-dynamic";

/** POST — send (or re-send) this invoice to the client by email, via the
 *  same Resend-backed `sendEmail` every other employer-triggered email in
 *  this codebase uses — no payment link, nothing but the invoice as a
 *  record. Requires a client email on file. Marks the invoice "sent" (from
 *  "draft") on the FIRST send only; a re-send of an already-sent invoice
 *  just re-delivers the email. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const invoice = await getInvoice(ctx.employerId, params.id);
  if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  if (!invoice.clientEmail) return NextResponse.json({ error: "This invoice has no client email on file." }, { status: 400 });
  if (invoice.status === "paid" || invoice.status === "void") return NextResponse.json({ error: `This invoice is already ${invoice.status} — nothing to send.` }, { status: 400 });

  const [profile, replyTo] = await Promise.all([getEmployerProfile(ctx.employerId), resolveUserEmail(ctx.userId)]);
  const companyName = profile?.companyName || "";

  const rows = invoice.lineItems
    .map((li) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${escapeHtml(li.description)}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${li.quantity} × ${formatMoney(li.unitPriceCents)}</td></tr>`)
    .join("");
  const html = emailShell(`
    <p>Hi ${escapeHtml(invoice.clientName)},</p>
    <p>${companyName ? escapeHtml(companyName) + " has" : "You've"} sent you invoice <strong>${escapeHtml(invoice.invoiceNumber)}</strong>, due ${escapeHtml(invoice.dueDate)}.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">${rows}</table>
    <p style="font-size:16px"><strong>Total due: ${formatMoney(invoice.amountCents)}</strong></p>
    <p>This is an invoice record only — please follow up with ${companyName ? escapeHtml(companyName) : "the sender"} directly to arrange payment.</p>
  `);

  const ok = await sendEmail({
    to: invoice.clientEmail,
    subject: `Invoice ${invoice.invoiceNumber}${companyName ? ` from ${companyName}` : ""}`,
    html,
    replyTo: replyTo || undefined,
    fromName: companyName || undefined,
  });
  if (!ok) return NextResponse.json({ error: "Could not send this invoice. Please check your email configuration and try again." }, { status: 502 });

  if (invoice.status === "draft") await setInvoiceStatus(ctx.employerId, params.id, "sent", { sentAt: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
