import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseEmployerPortal } from "@/lib/plan";
import { updateShift, deleteShift } from "@/lib/time-store";
import { isHHMM, hhmmToMinutes, parseISODate, formatHHMM } from "@/lib/time-hub";
import { logActivityForEmployee } from "@/lib/notifications-store";

export const runtime = "nodejs";

/** PATCH a shift's date/times/note. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx || !canUseEmployerPortal(ctx.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as { shiftDate?: string; startTime?: string; endTime?: string; note?: string };
  if (b.shiftDate !== undefined && !parseISODate(b.shiftDate)) return NextResponse.json({ error: "Bad date." }, { status: 400 });
  if (b.startTime !== undefined && !isHHMM(b.startTime)) return NextResponse.json({ error: "Bad start time." }, { status: 400 });
  if (b.endTime !== undefined && !isHHMM(b.endTime)) return NextResponse.json({ error: "Bad end time." }, { status: 400 });
  if (isHHMM(b.startTime) && isHHMM(b.endTime) && hhmmToMinutes(b.endTime) <= hhmmToMinutes(b.startTime))
    return NextResponse.json({ error: "End time must be after the start time." }, { status: 400 });

  const shift = await updateShift(ctx.employerId, id, b);
  if (!shift) return NextResponse.json({ error: "Could not update the shift." }, { status: 400 });

  // A draft edit isn't visible to the employee yet — only a live shift's
  // change is worth a notification (same "applies immediately" distinction
  // the grid's own UI already makes).
  if (shift.published) {
    logActivityForEmployee(ctx.employerId, shift.employeeId, {
      eventType: "schedule_published",
      title: `Your shift on ${shift.shiftDate} changed: ${formatHHMM(shift.startTime)}–${formatHHMM(shift.endTime)}`,
      link: "/employee/schedule",
    }).catch(() => {});
  }

  return NextResponse.json({ shift });
}

/** DELETE a shift. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx || !canUseEmployerPortal(ctx.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const deleted = await deleteShift(ctx.employerId, id);
  if (!deleted) return NextResponse.json({ error: "Could not delete the shift." }, { status: 400 });

  if (deleted.published) {
    logActivityForEmployee(ctx.employerId, deleted.employeeId, {
      eventType: "schedule_published",
      title: `Your shift on ${deleted.shiftDate} was removed`,
      link: "/employee/schedule",
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
