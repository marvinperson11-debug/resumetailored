import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseEmployerPortal } from "@/lib/plan";
import { listEmployees } from "@/lib/employees-store";
import { listEntriesForWeek, listReviewsForWeek } from "@/lib/time-store";
import { weekStartISO, buildTimesheetCSV, type CSVEmployeeWeek } from "@/lib/time-hub";

export const runtime = "nodejs";

/**
 * GET ?week=YYYY-MM-DD → a CSV of every employee's timesheet for the week. Raw
 * hours only; one row per (employee, entry) plus a per-employee total row.
 */
export async function GET(req: Request) {
  const ctx = await employerContext();
  if (!ctx || !canUseEmployerPortal(ctx.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const weekStart = weekStartISO(url.searchParams.get("week") || undefined);

  const [employees, reviews] = await Promise.all([listEmployees(ctx.employerId), listReviewsForWeek(ctx.employerId, weekStart)]);
  const reviewByEmployee = new Map(reviews.map((r) => [r.employeeId, r]));

  const rows: CSVEmployeeWeek[] = [];
  for (const e of employees) {
    const entries = await listEntriesForWeek(ctx.employerId, e.id, weekStart);
    if (entries.length === 0) continue; // skip employees with no hours this week
    rows.push({
      employeeName: e.name,
      employeeEmail: e.email,
      weekStart,
      status: reviewByEmployee.get(e.id)?.status || "pending",
      entries,
    });
  }

  const csv = buildTimesheetCSV(rows);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="timesheets_${weekStart}.csv"`,
    },
  });
}
