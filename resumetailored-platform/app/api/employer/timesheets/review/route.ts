import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseEmployerPortal } from "@/lib/plan";
import { getEmployee } from "@/lib/employees-store";
import { setReview } from "@/lib/time-store";
import { isReviewStatus, weekStartISO, weekLabel } from "@/lib/time-hub";
import { logActivityForEmployee } from "@/lib/notifications-store";

export const runtime = "nodejs";

/** POST { employeeId, weekStart, status: "approved"|"declined"|"pending", note? }
 *  → record the employer's decision for one employee's week. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx || !canUseEmployerPortal(ctx.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as { employeeId?: number; weekStart?: string; status?: string; note?: string };
  const employeeId = Number(b.employeeId);
  if (!Number.isFinite(employeeId)) return NextResponse.json({ error: "bad employee" }, { status: 400 });
  if (!isReviewStatus(b.status)) return NextResponse.json({ error: "bad status" }, { status: 400 });

  // Confirm the employee belongs to this employer before writing.
  const employee = await getEmployee(ctx.employerId, employeeId);
  if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

  const weekStart = weekStartISO(b.weekStart || undefined);
  const review = await setReview(ctx.employerId, employeeId, weekStart, b.status, b.note || "", ctx.userId);
  if (!review) return NextResponse.json({ error: "Could not save the review." }, { status: 500 });

  if (b.status === "approved" || b.status === "declined") {
    logActivityForEmployee(ctx.employerId, employeeId, {
      eventType: "timesheet_decided",
      title: `Your timesheet for ${weekLabel(weekStart)} was ${b.status}`,
      link: "/employee/timesheet",
    }).catch(() => {});
  }

  return NextResponse.json({ review });
}
