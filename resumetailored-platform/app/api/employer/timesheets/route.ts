import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseEmployerPortal } from "@/lib/plan";
import { listEmployees } from "@/lib/employees-store";
import { listEntriesForWeek, listReviewsForWeek } from "@/lib/time-store";
import { weekStartISO, sumHours, roundHours } from "@/lib/time-hub";

export const runtime = "nodejs";

/**
 * GET ?week=YYYY-MM-DD → every employee's weekly timesheet for the employer's
 * review: entries, summed raw hours, and the current approve/decline decision.
 * Raw hours only.
 */
export async function GET(req: Request) {
  const ctx = await employerContext();
  if (!ctx || !canUseEmployerPortal(ctx.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const weekStart = weekStartISO(url.searchParams.get("week") || undefined);

  const [employees, reviews] = await Promise.all([listEmployees(ctx.employerId), listReviewsForWeek(ctx.employerId, weekStart)]);
  const reviewByEmployee = new Map(reviews.map((r) => [r.employeeId, r]));

  const rows = await Promise.all(
    employees.map(async (e) => {
      const entries = await listEntriesForWeek(ctx.employerId, e.id, weekStart);
      return {
        employee: { id: e.id, name: e.name, email: e.email, role: e.role, inviteStatus: e.inviteStatus },
        entries,
        totalHours: roundHours(sumHours(entries)),
        review: reviewByEmployee.get(e.id) || null,
      };
    })
  );

  return NextResponse.json({ weekStart, rows });
}
