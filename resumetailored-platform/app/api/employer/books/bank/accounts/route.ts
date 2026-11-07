import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseFullBooks } from "@/lib/employer-plan";
import { listBankAccounts, disconnectBankAccount } from "@/lib/books-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseFullBooks(ctx.access)) return NextResponse.json({ error: "Bank feeds are available on the Corporate plan." }, { status: 403 });

  const accounts = await listBankAccounts(ctx.employerId);
  return NextResponse.json({ accounts });
}

/** DELETE ?id= — disconnect a bank account. Historical transactions and any
 *  matches they made stay (this is a bookkeeping record, not something to
 *  delete), only the live connection is marked disconnected. */
export async function DELETE(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseFullBooks(ctx.access)) return NextResponse.json({ error: "Bank feeds are available on the Corporate plan." }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const ok = await disconnectBankAccount(ctx.employerId, id);
  return NextResponse.json({ ok });
}
