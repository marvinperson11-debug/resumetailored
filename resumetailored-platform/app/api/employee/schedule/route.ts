import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { listPublishedShiftsForEmployee, listTimeOffForEmployee } from "@/lib/time-store";
import { weekStartISO } from "@/lib/time-hub";

export const runtime = "nodejs";

/**
 * GET the employee's "My schedule": their PUBLISHED upcoming shifts (from the
 * start of the current week onward) plus their own approved time off, so both
 * render on one timeline.
 */
export async function GET() {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const from = weekStartISO(); // start of the current week
  const [shifts, requests] = await Promise.all([
    listPublishedShiftsForEmployee(ctx.employerId, ctx.employeeId, from),
    listTimeOffForEmployee(ctx.employerId, ctx.employeeId),
  ]);
  const approvedTimeOff = requests.filter((r) => r.status === "approved");
  return NextResponse.json({ shifts, approvedTimeOff });
}
