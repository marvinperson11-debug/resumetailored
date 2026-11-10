import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseOnboardingTools } from "@/lib/employer-plan";
import { getEmployee } from "@/lib/employees-store";
import { getOnboardingPlan } from "@/lib/onboarding-store";
import { listQueuedForPendingAction } from "@/lib/assistant-send-queue";
import { ensureDayOneTasks, listDayOneTasks } from "@/lib/day-one-tasks";
import { getPaperworkForEmployee } from "@/lib/paperwork-store";
import { getAcknowledgmentByDocAndEmployee, ensureAcknowledgments } from "@/lib/training-store";
import { getOrCreateHandbookDoc } from "@/lib/handbook";
import { listEnvelopesForEmail } from "@/lib/docusign-store";

export const runtime = "nodejs";

/**
 * GET — one hire's full onboarding page (prompt item 2): the approved plan
 * (first-week schedule, paperwork due dates, reminder texts + their real
 * send status), the live day-one task list, the paperwork packet's real
 * status (offer / W-4 / I-9 / direct deposit / handbook), and the
 * checklist's own progress (fetched separately by the client from the
 * existing .../checklist route, which this intentionally doesn't duplicate).
 *
 * `plan` is null for an employee with no `applicantId` (added by hand) or
 * no approved plan yet — the client renders the "Start onboarding" /
 * explainer state for that case.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const employeeId = Number(params.id);
  const employee = await getEmployee(ctx.employerId, employeeId);
  if (!employee) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!canUseOnboardingTools(ctx.access)) {
    return NextResponse.json({ employee, locked: true, plan: null, dayOneTasks: [], paperwork: null, handbook: null, offer: null, reminders: [] });
  }

  const planRow = employee.applicantId ? await getOnboardingPlan(ctx.employerId, employee.applicantId) : null;

  let dayOneTasks = await listDayOneTasks(ctx.employerId, employeeId);
  if (dayOneTasks.length === 0 && planRow?.plan.dayOneChecklist?.length) {
    dayOneTasks = await ensureDayOneTasks(ctx.employerId, employeeId, planRow.plan.dayOneChecklist);
  }

  const [paperwork, handbookDoc, offerEnvelopes, reminders] = await Promise.all([
    getPaperworkForEmployee(ctx.employerId, employeeId),
    getOrCreateHandbookDoc(ctx.employerId),
    employee.email ? listEnvelopesForEmail(ctx.employerId, employee.email) : Promise.resolve([]),
    planRow ? listQueuedForPendingAction(planRow.pendingActionId) : Promise.resolve([]),
  ]);
  if (handbookDoc) await ensureAcknowledgments(ctx.employerId, handbookDoc, [employee], null);
  const handbookAck = handbookDoc ? await getAcknowledgmentByDocAndEmployee(ctx.employerId, handbookDoc.id, employeeId) : null;
  const offer = offerEnvelopes.find((e) => e.docType === "offer") || null;

  return NextResponse.json({
    employee,
    locked: false,
    plan: planRow ? { status: planRow.status, pendingActionId: planRow.pendingActionId, ...planRow.plan } : null,
    dayOneTasks,
    paperwork,
    handbook: handbookAck
      ? { status: handbookAck.status, acknowledgedAt: handbookAck.acknowledgedAt, docTitle: handbookDoc?.title || "", signedVersion: handbookAck.docVersion, currentVersion: handbookDoc?.version ?? 1 }
      : { status: "not_assigned", acknowledgedAt: null, docTitle: handbookDoc?.title || "", signedVersion: null, currentVersion: handbookDoc?.version ?? 1 },
    offer: offer ? { status: offer.status, sentAt: offer.sentAt, completedAt: offer.completedAt } : null,
    reminders: reminders.map((r) => ({ id: r.id, sendAt: r.sendAt, status: r.status, sentAt: r.sentAt, body: r.body })),
  });
}
