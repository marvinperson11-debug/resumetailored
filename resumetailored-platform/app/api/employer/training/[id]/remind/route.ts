import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { getTrainingDoc, complianceGrid, markReminded } from "@/lib/training-store";
import { sendTrainingReminder } from "@/lib/training-notify";
import { complianceState } from "@/lib/employee-hub";

export const runtime = "nodejs";

/**
 * POST send reminder emails for a training doc's pending/overdue
 * acknowledgments. Body `{ employeeId }` reminds just that employee; omit it to
 * remind everyone still outstanding (bulk). Signed/waived rows are skipped.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can send reminders." }, { status: 403 });

  const doc = await getTrainingDoc(ctx.employerId, Number(params.id));
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { employeeId?: number };
  const onlyEmployee = Number.isFinite(b.employeeId) ? Number(b.employeeId) : null;

  const grid = await complianceGrid(ctx.employerId, doc);
  const outstanding = grid.filter(
    (cell) =>
      cell.ack &&
      (complianceState(cell.ack) === "pending" || complianceState(cell.ack) === "overdue") &&
      cell.employee.email &&
      (onlyEmployee === null || cell.employee.id === onlyEmployee)
  );

  let sent = 0;
  const remindedIds: number[] = [];
  for (const cell of outstanding) {
    const ok = await sendTrainingReminder(ctx.employerId, cell.employee, doc, cell.ack!);
    if (ok) {
      sent++;
      remindedIds.push(cell.ack!.id);
    }
  }
  if (remindedIds.length) await markReminded(ctx.employerId, remindedIds);

  return NextResponse.json({ sent, outstanding: outstanding.length });
}
