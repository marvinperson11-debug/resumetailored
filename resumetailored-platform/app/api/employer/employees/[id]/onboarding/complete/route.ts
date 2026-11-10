import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { canUseOnboardingTools } from "@/lib/employer-plan";
import { getEmployee } from "@/lib/employees-store";
import { completeOnboardingPlan } from "@/lib/onboarding-chase";

export const runtime = "nodejs";

/** POST — stop this hire's onboarding plan (prompt item 7: "the employer
 *  can stop them"). Same lib/onboarding-chase.ts `completeOnboardingPlan`
 *  Taylor's own `complete_onboarding` tool calls — one code path, reached
 *  either from chat or this button. Instant, no approval needed, same as
 *  every other disable switch in this feature. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can stop an onboarding plan." }, { status: 403 });
  if (!canUseOnboardingTools(ctx.access)) return NextResponse.json({ error: "Onboarding plans are part of the Portal plan." }, { status: 403 });
  const employeeId = Number(params.id);
  const employee = await getEmployee(ctx.employerId, employeeId);
  if (!employee || !employee.applicantId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await completeOnboardingPlan(ctx.employerId, employee.applicantId);
  return NextResponse.json(result);
}
