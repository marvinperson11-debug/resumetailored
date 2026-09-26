import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { listTimeOffForEmployee, createTimeOff } from "@/lib/time-store";
import { isTimeOffKind, parseISODate, timeOffRangeLabel } from "@/lib/time-hub";
import { logActivityForEmployer } from "@/lib/notifications-store";

export const runtime = "nodejs";

/** GET the employee's own time-off requests, newest first. */
export async function GET() {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const requests = await listTimeOffForEmployee(ctx.employerId, ctx.employeeId);
  return NextResponse.json({ requests });
}

/** POST a new time-off request. Body: { startDate, endDate, kind, reason? }. */
export async function POST(req: Request) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as { startDate?: string; endDate?: string; kind?: string; reason?: string };

  if (!b.startDate || !parseISODate(b.startDate)) return NextResponse.json({ error: "Pick a valid start date." }, { status: 400 });
  const endDate = b.endDate && parseISODate(b.endDate) ? b.endDate : b.startDate; // default to a single day
  if (endDate < b.startDate) return NextResponse.json({ error: "The end date can't be before the start date." }, { status: 400 });
  if (!isTimeOffKind(b.kind)) return NextResponse.json({ error: "Pick a time-off type." }, { status: 400 });

  const request = await createTimeOff(ctx.employerId, ctx.employeeId, {
    startDate: b.startDate,
    endDate,
    kind: b.kind,
    reason: b.reason,
  });
  if (!request) return NextResponse.json({ error: "Could not submit your request." }, { status: 500 });

  logActivityForEmployer(ctx.employerId, {
    eventType: "time_off_requested",
    title: `${ctx.employee.name || "An employee"} requested time off (${timeOffRangeLabel(request)})`,
    link: "/employer/time-off",
  }).catch(() => {});

  return NextResponse.json({ request });
}
