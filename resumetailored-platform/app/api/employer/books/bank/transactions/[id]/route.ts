import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseFullBooks } from "@/lib/employer-plan";
import { getBankTransaction, setTransactionMatch, createEntry, getEntry } from "@/lib/books-store";
import { UNCATEGORIZED } from "@/lib/books-hub";

export const dynamic = "force-dynamic";

/** POST — the bank-feed review action for one unmatched transaction. Body:
 *  { action: "match", entryId } — confirm it's the same as an existing entry.
 *  { action: "ignore" } — not a business transaction; stays reviewed, never resurfaces as unmatched.
 *  { action: "create-entry", category? } — no existing entry covers it; create one from the bank data.
 *  Plaid's sign convention for a depository account: a positive amount is
 *  money leaving the account (an expense), negative is money coming in
 *  (income) — applied only for "create-entry"; "match" instead takes
 *  whatever type the chosen existing entry already has. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseFullBooks(ctx.access)) return NextResponse.json({ error: "Bank feeds are available on the Corporate plan." }, { status: 403 });

  const txn = await getBankTransaction(ctx.employerId, params.id);
  if (!txn) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; entryId?: string; category?: string };

  if (body.action === "ignore") {
    const ok = await setTransactionMatch(ctx.employerId, params.id, { matchStatus: "ignored" });
    return NextResponse.json({ ok });
  }

  if (body.action === "match") {
    const entryId = String(body.entryId || "").trim();
    const entry = entryId ? await getEntry(ctx.employerId, entryId) : null;
    if (!entry) return NextResponse.json({ error: "entryId must name an existing entry of yours." }, { status: 400 });
    const ok = await setTransactionMatch(ctx.employerId, params.id, { matchStatus: "matched", matchedEntryId: entry.id });
    return NextResponse.json({ ok });
  }

  if (body.action === "create-entry") {
    const type = txn.amountCents > 0 ? "expense" : "income";
    const entry = await createEntry(ctx.employerId, ctx.userId, {
      type,
      entryDate: txn.txnDate,
      amountCents: Math.abs(txn.amountCents),
      description: txn.merchantName || txn.name,
      category: String(body.category || "").trim().slice(0, 80) || UNCATEGORIZED,
      source: "plaid",
    });
    if (!entry) return NextResponse.json({ error: "Could not create an entry from this transaction." }, { status: 500 });
    const ok = await setTransactionMatch(ctx.employerId, params.id, { matchStatus: "matched", matchedEntryId: entry.id });
    return NextResponse.json({ ok, entry });
  }

  return NextResponse.json({ error: "action must be 'match', 'ignore', or 'create-entry'." }, { status: 400 });
}
