import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { submitI9Section1, type I9Section1Input } from "@/lib/paperwork-store";

export const runtime = "nodejs";

const CITIZENSHIP_STATUSES = new Set(["citizen", "noncitizen_national", "lawful_permanent_resident", "authorized_alien"]);

/** POST — I-9 Section 1: the new hire's own citizenship/work-authorization
 *  attestation, referencing an ID document already uploaded via
 *  /api/employee/onboarding/id-upload. "V1 collects it and tracks Section 2
 *  completion. V1 does NOT do E-Verify." Section 2 (the employer's own
 *  confirmation) is a separate, employer-only step. */
export async function POST(req: Request) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Partial<I9Section1Input>;
  if (!b.citizenshipStatus || !CITIZENSHIP_STATUSES.has(b.citizenshipStatus)) return NextResponse.json({ error: "Pick a citizenship/work-authorization status." }, { status: 400 });
  if (!b.fullLegalName?.trim() || !b.signatureName?.trim() || !b.idDocPath) {
    return NextResponse.json({ error: "Your full legal name, a signature, and an uploaded ID document are required." }, { status: 400 });
  }
  if (!b.idDocPath.startsWith(`${ctx.employerId}/${ctx.employeeId}-id-`)) {
    return NextResponse.json({ error: "That document wasn't uploaded for this account." }, { status: 400 });
  }

  const row = await submitI9Section1(ctx.employerId, ctx.employeeId, {
    citizenshipStatus: b.citizenshipStatus,
    fullLegalName: b.fullLegalName,
    signatureName: b.signatureName,
    idDocPath: b.idDocPath,
  });
  if (!row) return NextResponse.json({ error: "Could not save your I-9." }, { status: 500 });
  return NextResponse.json({ paperwork: row });
}
