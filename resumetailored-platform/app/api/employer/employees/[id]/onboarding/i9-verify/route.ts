import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { canUseOnboardingTools } from "@/lib/employer-plan";
import { getEmployee } from "@/lib/employees-store";
import { verifyI9Section2 } from "@/lib/paperwork-store";
import { resolveUserEmail } from "@/lib/email";

export const runtime = "nodejs";

/** POST — I-9 Section 2: the employer confirms they examined the new
 *  hire's identity/work-authorization document (submitted in Section 1) and
 *  records it. This is the ONLY thing V1 does for I-9 — no E-Verify call, no
 *  submission to any agency. Body: { documentTitle } e.g. "US Passport". */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can verify I-9 documents." }, { status: 403 });
  if (!canUseOnboardingTools(ctx.access)) return NextResponse.json({ error: "The paperwork packet is part of the Portal plan." }, { status: 403 });
  const employeeId = Number(params.id);
  const employee = await getEmployee(ctx.employerId, employeeId);
  if (!employee) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { documentTitle?: string };
  const verifiedBy = (await resolveUserEmail(ctx.userId).catch(() => null)) || ctx.userId;
  const row = await verifyI9Section2(ctx.employerId, employeeId, verifiedBy, b.documentTitle || "");
  if (!row) return NextResponse.json({ error: "The new hire hasn't submitted Section 1 yet, or this is already verified." }, { status: 400 });
  return NextResponse.json({ paperwork: row });
}
