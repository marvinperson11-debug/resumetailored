import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { listEntriesForWeek, getReview } from "@/lib/time-store";
import { weekStartISO, sumHours, roundHours, type WeekTimesheet } from "@/lib/time-hub";

export const runtime = "nodejs";

/**
 * GET ?week=YYYY-MM-DD (any date in the week; snapped to its Monday) → the
 * employee's own timesheet for that week: entries, summed raw hours, and the
 * employer's review decision (read-only for the employee).
 */
export async function GET(req: Request) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const weekStart = weekStartISO(url.searchParams.get("week") || undefined);

  const [entries, review] = await Promise.all([
    listEntriesForWeek(ctx.employerId, ctx.employeeId, weekStart),
    getReview(ctx.employerId, ctx.employeeId, weekStart),
  ]);

  const timesheet: WeekTimesheet = {
    weekStart,
    entries,
    totalHours: roundHours(sumHours(entries)),
    review,
  };
  return NextResponse.json({ timesheet });
}
