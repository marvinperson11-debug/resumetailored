import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { submitTimesheet } from "@/lib/time-store";
import { weekStartISO, weekLabel } from "@/lib/time-hub";
import { logActivityForEmployer } from "@/lib/notifications-store";

export const runtime = "nodejs";

/** POST { week } → the employee flags a week's hours ready for the
 *  employer's review. Raw hours only — this is a status signal, not a
 *  payroll submission. */
export async function POST(req: Request) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { week?: string };
  const weekStart = weekStartISO(b.week || undefined);

  const review = await submitTimesheet(ctx.employerId, ctx.employeeId, weekStart);
  if (!review) return NextResponse.json({ error: "Could not submit your timesheet." }, { status: 500 });

  logActivityForEmployer(ctx.employerId, {
    eventType: "timesheet_submitted",
    title: `${ctx.employee.name || "An employee"} submitted their timesheet for ${weekLabel(weekStart)}`,
    link: "/employer/timesheets",
  }).catch(() => {});

  return NextResponse.json({ review });
}
