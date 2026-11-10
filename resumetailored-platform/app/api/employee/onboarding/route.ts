import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { getOnboardingPlan } from "@/lib/onboarding-store";
import { getPaperworkForEmployee } from "@/lib/paperwork-store";
import { getOrCreateHandbookDoc } from "@/lib/handbook";
import { getAcknowledgmentByDocAndEmployee, ensureAcknowledgments } from "@/lib/training-store";
import { canUseWhiteLabelForTier } from "@/lib/employer-plan";

export const runtime = "nodejs";

/** GET — the new hire's own onboarding view: the approved plan's first-week
 *  schedule + paperwork due dates (read-only — dates come from the plan
 *  engine, never the model), and their own paperwork packet status so the
 *  portal page knows which forms still need action. The handbook is
 *  reported as a doc id + ack status; the employee reads/signs it through
 *  the existing /employee/training/:id flow, not a duplicate page. */
export async function GET() {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const planRow = ctx.employee.applicantId ? await getOnboardingPlan(ctx.employerId, ctx.employee.applicantId) : null;
  const [paperwork, handbookDoc, whiteLabel] = await Promise.all([
    getPaperworkForEmployee(ctx.employerId, ctx.employeeId),
    getOrCreateHandbookDoc(ctx.employerId),
    canUseWhiteLabelForTier(ctx.employerId),
  ]);
  if (handbookDoc) await ensureAcknowledgments(ctx.employerId, handbookDoc, [ctx.employee], null);
  const handbookAck = handbookDoc ? await getAcknowledgmentByDocAndEmployee(ctx.employerId, handbookDoc.id, ctx.employeeId) : null;

  return NextResponse.json({
    plan: planRow ? { startDateDisplay: planRow.plan.startDateDisplay, firstWeekSchedule: planRow.plan.firstWeekSchedule, paperwork: planRow.plan.paperwork } : null,
    paperwork: {
      w4: { status: paperwork.w4?.status || "not_started" },
      i9: { status: paperwork.i9?.status || "not_started" },
      direct_deposit: paperwork.direct_deposit ? { status: paperwork.direct_deposit.status, last4: paperwork.direct_deposit.last4 } : { status: "not_started", last4: null },
    },
    handbook: handbookDoc ? { docId: handbookDoc.id, title: handbookDoc.title, status: handbookAck?.status || "pending" } : null,
    // White-label new-hire portal (Corporate only) — same mechanism as the
    // public careers page's own badge removal (lib/employer-plan.ts
    // `canUseWhiteLabelForTier`), resolved by the employer's own userId
    // since this is the new hire's session, not the employer's.
    whiteLabel,
  });
}
