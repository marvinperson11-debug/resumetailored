import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBooks } from "@/lib/employer-plan";
import { listEntries, listInvoices } from "@/lib/books-store";
import { isTaylorBooksIntent, answerTaylorBooksQuestion } from "@/lib/books-hub";
import { logAction } from "@/lib/assistant-audit";

export const dynamic = "force-dynamic";

/** POST { intent } — Taylor's three read-only Books answers (spec V1):
 *  "how much did we spend this month?", "what's unpaid?", and a monthly
 *  summary. See lib/books-hub.ts `answerTaylorBooksQuestion`'s header for
 *  why this is a deterministic lookup rather than a turn through the
 *  Employer Portal Assistant's own (hiring-only) chat loop. Still logged to
 *  the SAME audit log every other Taylor action uses
 *  (lib/assistant-audit.ts) — read-only, but the spec asks for every
 *  Taylor action to leave a trail, money-facing or not. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { intent?: string };
  if (!isTaylorBooksIntent(body.intent)) return NextResponse.json({ error: "intent must be 'spend_this_month', 'unpaid_invoices', or 'monthly_summary'." }, { status: 400 });

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const monthEnd = now.toISOString().slice(0, 10);
  const locale = await getLocale();
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(now);

  const [monthEntries, invoices] = await Promise.all([listEntries(ctx.employerId, { from: monthStart, to: monthEnd }), listInvoices(ctx.employerId)]);
  const unpaidInvoices = invoices.filter((i) => i.status === "sent" || i.status === "overdue");

  const answer = answerTaylorBooksQuestion({ intent: body.intent, monthEntries, unpaidInvoices, monthLabel });

  await logAction({ employerId: ctx.employerId, actorUserId: ctx.userId, action: `books_taylor_${body.intent}`, targetType: null, targetId: null, payload: { intent: body.intent }, status: "executed" });

  return NextResponse.json({ answer });
}
