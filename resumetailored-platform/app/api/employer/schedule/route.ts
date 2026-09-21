import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseEmployerPortal } from "@/lib/plan";
import { listEmployees, getEmployee } from "@/lib/employees-store";
import { listShiftsForWeek, createShift, listAvailabilityForEmployer, listApprovedTimeOffForWeek } from "@/lib/time-store";
import { weekStartISO, isHHMM, hhmmToMinutes, parseISODate, weekDates } from "@/lib/time-hub";

export const runtime = "nodejs";

/**
 * GET ?week=YYYY-MM-DD → the employer's scheduling view for the week: the
 * workforce roster, all shifts (draft + published), every employee's
 * availability, and approved time off overlapping the week.
 */
export async function GET(req: Request) {
  const ctx = await employerContext();
  if (!ctx || !canUseEmployerPortal(ctx.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const weekStart = weekStartISO(url.searchParams.get("week") || undefined);

  const [employees, shifts, availability, timeOff] = await Promise.all([
    listEmployees(ctx.employerId),
    listShiftsForWeek(ctx.employerId, weekStart),
    listAvailabilityForEmployer(ctx.employerId),
    listApprovedTimeOffForWeek(ctx.employerId, weekStart),
  ]);

  return NextResponse.json({
    weekStart,
    days: weekDates(weekStart),
    employees: employees.map((e) => ({ id: e.id, name: e.name, role: e.role, inviteStatus: e.inviteStatus })),
    shifts,
    availability,
    timeOff,
    // Any draft (unpublished) shift means "Publish" has something to do.
    hasDrafts: shifts.some((s) => !s.published),
  });
}

/** POST a new shift. Body: { employeeId, shiftDate, startTime, endTime, note? }. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx || !canUseEmployerPortal(ctx.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as {
    employeeId?: number;
    shiftDate?: string;
    startTime?: string;
    endTime?: string;
    note?: string;
  };

  const employeeId = Number(b.employeeId);
  if (!Number.isFinite(employeeId)) return NextResponse.json({ error: "Pick an employee." }, { status: 400 });
  if (!b.shiftDate || !parseISODate(b.shiftDate)) return NextResponse.json({ error: "Pick a valid date." }, { status: 400 });
  if (!isHHMM(b.startTime) || !isHHMM(b.endTime)) return NextResponse.json({ error: "Enter valid start and end times." }, { status: 400 });
  if (hhmmToMinutes(b.endTime) <= hhmmToMinutes(b.startTime))
    return NextResponse.json({ error: "End time must be after the start time." }, { status: 400 });

  const employee = await getEmployee(ctx.employerId, employeeId);
  if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

  const shift = await createShift(ctx.employerId, {
    employeeId,
    shiftDate: b.shiftDate,
    startTime: b.startTime,
    endTime: b.endTime,
    note: b.note,
  });
  if (!shift) return NextResponse.json({ error: "Could not create the shift." }, { status: 500 });
  return NextResponse.json({ shift });
}
