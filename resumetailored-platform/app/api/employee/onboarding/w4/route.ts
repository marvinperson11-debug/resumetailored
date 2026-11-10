import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { submitW4, type W4Input } from "@/lib/paperwork-store";

export const runtime = "nodejs";

const FILING_STATUSES = new Set(["single", "married_jointly", "head_of_household"]);

/** POST — the new hire's own W-4 withholding elections (no SSN collected —
 *  see lib/paperwork-store.ts's `W4Input` doc comment for why). "The
 *  employee fills it in, the employer keeps it on file. It is NOT filed
 *  with the IRS." */
export async function POST(req: Request) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Partial<W4Input>;
  if (!b.filingStatus || !FILING_STATUSES.has(b.filingStatus)) return NextResponse.json({ error: "Pick a filing status." }, { status: 400 });
  if (!b.signatureName || !b.signatureName.trim()) return NextResponse.json({ error: "A signature is required." }, { status: 400 });

  const row = await submitW4(ctx.employerId, ctx.employeeId, {
    filingStatus: b.filingStatus,
    multipleJobsOrSpouseWorks: !!b.multipleJobsOrSpouseWorks,
    claimDependentsCents: Number(b.claimDependentsCents) || 0,
    otherIncomeCents: Number(b.otherIncomeCents) || 0,
    deductionsCents: Number(b.deductionsCents) || 0,
    extraWithholdingCents: Number(b.extraWithholdingCents) || 0,
    signatureName: b.signatureName,
  });
  if (!row) return NextResponse.json({ error: "Could not save your W-4." }, { status: 500 });
  return NextResponse.json({ paperwork: row });
}
