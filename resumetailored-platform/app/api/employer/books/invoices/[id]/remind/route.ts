import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBooks } from "@/lib/employer-plan";
import { getInvoice, setInvoiceStatus } from "@/lib/books-store";
import { getEmployerProfile } from "@/lib/employer-store";
import { sendEmail, emailShell, escapeHtml, resolveUserEmail } from "@/lib/email";
import { formatMoney, isInvoiceOverdue } from "@/lib/books-hub";

export const dynamic = "force-dynamic";

/** POST — send an overdue-reminder email for a previously-sent invoice.
 *  Records the reminder (lastReminderAt) and, if the invoice is in fact
 *  past its due date, flips its status to "overdue" — reminders and
 *  records only, never a payment action. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const invoice = await getInvoice(ctx.employerId, params.id);
  if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  if (!invoice.clientEmail) return NextResponse.json({ error: "This invoice has no client email on file." }, { status: 400 });
  if (invoice.status === "paid" || invoice.status === "void" || invoice.status === "draft") {
    return NextResponse.json({ error: `Can't send a reminder for a ${invoice.status} invoice.` }, { status: 400 });
  }

  const [profile, replyTo] = await Promise.all([getEmployerProfile(ctx.employerId), resolveUserEmail(ctx.userId)]);
  const companyName = profile?.companyName || "";
  const html = emailShell(`
    <p>Hi ${escapeHtml(invoice.clientName)},</p>
    <p>Just a friendly reminder that invoice <strong>${escapeHtml(invoice.invoiceNumber)}</strong> for <strong>${formatMoney(invoice.amountCents)}</strong> was due ${escapeHtml(invoice.dueDate)} and hasn't been marked paid yet.</p>
    <p>Please follow up with ${companyName ? escapeHtml(companyName) : "the sender"} directly to arrange payment.</p>
  `);

  const ok = await sendEmail({
    to: invoice.clientEmail,
    subject: `Reminder: Invoice ${invoice.invoiceNumber} is overdue`,
    html,
    replyTo: replyTo || undefined,
    fromName: companyName || undefined,
  });
  if (!ok) return NextResponse.json({ error: "Could not send this reminder. Please check your email configuration and try again." }, { status: 502 });

  const nowIso = new Date().toISOString();
  const nextStatus = isInvoiceOverdue(invoice) ? "overdue" : invoice.status;
  await setInvoiceStatus(ctx.employerId, params.id, nextStatus, { lastReminderAt: nowIso });
  return NextResponse.json({ ok: true });
}
