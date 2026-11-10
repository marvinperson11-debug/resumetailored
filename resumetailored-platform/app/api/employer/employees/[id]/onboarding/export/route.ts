import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseOnboardingAuditExport } from "@/lib/employer-plan";
import { getEmployee } from "@/lib/employees-store";
import { getOnboardingPlan } from "@/lib/onboarding-store";
import { listQueuedForPendingAction } from "@/lib/assistant-send-queue";
import { listDayOneTasks } from "@/lib/day-one-tasks";
import { getPaperworkForEmployee } from "@/lib/paperwork-store";
import { getAcknowledgmentByDocAndEmployee } from "@/lib/training-store";
import { getOrCreateHandbookDoc } from "@/lib/handbook";
import { listEnvelopesForEmail } from "@/lib/docusign-store";
import { getLatestEmployeeChecklist } from "@/lib/checklist-store";
import { buildOnboardingAuditText } from "@/lib/onboarding-audit-export";

export const runtime = "nodejs";

/**
 * GET — the whole onboarding trail for one hire (plan, checklist states
 * with timestamps, paperwork states, reminders sent, signatures) as a
 * downloadable plain-text file. Corporate only (lib/employer-plan.ts
 * `canUseOnboardingAuditExport`) — below Corporate this 403s with a plain
 * upgrade message, same as every other gated-action-attempt in this
 * feature; the button that calls this is visible at every tier.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const employeeId = Number(params.id);
  const employee = await getEmployee(ctx.employerId, employeeId);
  if (!employee) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!canUseOnboardingAuditExport(ctx.access)) {
    return NextResponse.json({ error: "The onboarding audit export is part of the Corporate plan. Portal and Scale keep the live onboarding page you can already see." }, { status: 403 });
  }

  const planRow = employee.applicantId ? await getOnboardingPlan(ctx.employerId, employee.applicantId) : null;
  const [dayOneTasks, paperwork, handbookDoc, offerEnvelopes, checklist] = await Promise.all([
    listDayOneTasks(ctx.employerId, employeeId),
    getPaperworkForEmployee(ctx.employerId, employeeId),
    getOrCreateHandbookDoc(ctx.employerId),
    employee.email ? listEnvelopesForEmail(ctx.employerId, employee.email) : Promise.resolve([]),
    getLatestEmployeeChecklist(ctx.employerId, employeeId),
  ]);
  const handbookAck = handbookDoc ? await getAcknowledgmentByDocAndEmployee(ctx.employerId, handbookDoc.id, employeeId) : null;
  const offer = offerEnvelopes.find((e) => e.docType === "offer") || null;
  const reminders = planRow ? await listQueuedForPendingAction(planRow.pendingActionId) : [];

  const text = buildOnboardingAuditText({
    employeeName: employee.name,
    employeeEmail: employee.email,
    startDateDisplay: planRow?.plan.startDateDisplay || employee.startDate || "",
    generatedAt: new Date().toISOString(),
    plan: planRow ? { status: planRow.status, firstWeekSchedule: planRow.plan.firstWeekSchedule, paperwork: planRow.plan.paperwork } : null,
    checklist,
    dayOneTasks: dayOneTasks.map((t) => ({ label: t.label, done: t.done, doneAt: t.doneAt })),
    paperworkStatus: {
      w4: paperwork.w4 ? { status: paperwork.w4.status, submittedAt: paperwork.w4.submittedAt } : null,
      i9: paperwork.i9 ? { status: paperwork.i9.status, submittedAt: paperwork.i9.submittedAt, verifiedAt: paperwork.i9.verifiedAt, verifiedBy: paperwork.i9.verifiedBy } : null,
      direct_deposit: paperwork.direct_deposit ? { status: paperwork.direct_deposit.status, submittedAt: paperwork.direct_deposit.submittedAt } : null,
    },
    offer: offer ? { status: offer.status, sentAt: offer.sentAt, completedAt: offer.completedAt } : null,
    handbook: {
      docTitle: handbookDoc?.title || "",
      status: handbookAck?.status || "not_assigned",
      acknowledgedAt: handbookAck?.acknowledgedAt || null,
      signedVersion: handbookAck?.docVersion ?? null,
      currentVersion: handbookDoc?.version ?? 1,
    },
    reminders: (planRow?.plan.reminders || []).map((r) => {
      const sent = reminders.find((q) => Math.abs(new Date(q.sendAt).getTime() - new Date(r.sendAt).getTime()) < 1000);
      return { whenLabel: r.whenLabel, sendAt: r.sendAt, status: sent?.status || "queued", sentAt: sent?.sentAt || null };
    }),
  });

  return new NextResponse(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="onboarding-audit-${employeeId}.txt"`,
    },
  });
}
