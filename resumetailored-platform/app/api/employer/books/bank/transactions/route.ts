import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseFullBooks } from "@/lib/employer-plan";
import { listUnmatchedTransactions, listEntries } from "@/lib/books-store";

export const dynamic = "force-dynamic";

const CANDIDATE_WINDOW_DAYS = 5;

function withinDays(a: string, b: string, days: number): boolean {
  const diff = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return diff <= days * 86400_000;
}

/** GET — unmatched Plaid transactions, each with up to 5 "candidate"
 *  existing entries (same employer, amount matching exactly, date within
 *  ±5 days) for the review UI's "match to an existing entry" action. The
 *  other action, "add as entry" (no candidates needed), is handled by
 *  bank/transactions/[id] directly. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseFullBooks(ctx.access)) return NextResponse.json({ error: "Bank feeds are available on the Corporate plan." }, { status: 403 });

  const [transactions, entries] = await Promise.all([listUnmatchedTransactions(ctx.employerId), listEntries(ctx.employerId)]);
  const withCandidates = transactions.map((txn) => {
    const absCents = Math.abs(txn.amountCents);
    const candidates = entries.filter((e) => e.amountCents === absCents && withinDays(e.entryDate, txn.txnDate, CANDIDATE_WINDOW_DAYS)).slice(0, 5);
    return { ...txn, candidates };
  });
  return NextResponse.json({ transactions: withCandidates });
}
