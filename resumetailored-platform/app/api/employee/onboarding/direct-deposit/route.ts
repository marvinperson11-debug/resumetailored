import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { submitDirectDeposit, type DirectDepositInput } from "@/lib/paperwork-store";

export const runtime = "nodejs";

/** POST — the new hire's own bank details for direct deposit. "V1 collects
 *  it. V1 does not move money." The full account/routing numbers are
 *  encrypted at rest (lib/paperwork-crypto.ts) and never returned by any
 *  route after this one — only the last 4 digits are kept for display. */
export async function POST(req: Request) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Partial<DirectDepositInput>;
  if (!b.bankName || !b.routingNumber || !b.accountNumber || !b.signatureName) {
    return NextResponse.json({ error: "Bank name, routing number, account number, and a signature are required." }, { status: 400 });
  }

  const result = await submitDirectDeposit(ctx.employerId, ctx.employeeId, {
    bankName: b.bankName,
    accountType: b.accountType === "savings" ? "savings" : "checking",
    routingNumber: b.routingNumber,
    accountNumber: b.accountNumber,
    signatureName: b.signatureName,
  });
  if (!result.ok) {
    const message =
      result.reason === "not_configured"
        ? "Direct deposit isn't available on this deployment yet. Ask your employer to try again later."
        : result.reason === "invalid"
          ? "Check your routing number (9 digits) and account number."
          : "Could not save your direct deposit details.";
    return NextResponse.json({ error: message }, { status: result.reason === "not_configured" ? 503 : 400 });
  }
  return NextResponse.json({ paperwork: result.row });
}
