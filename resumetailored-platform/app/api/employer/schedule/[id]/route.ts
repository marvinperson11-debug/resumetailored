import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseEmployerPortal } from "@/lib/plan";
import { updateShift, deleteShift } from "@/lib/time-store";
import { isHHMM, hhmmToMinutes, parseISODate } from "@/lib/time-hub";

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
  return NextResponse.json({ shift });
}

/** DELETE a shift. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx || !canUseEmployerPortal(ctx.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const ok = await deleteShift(ctx.employerId, id);
  if (!ok) return NextResponse.json({ error: "Could not delete the shift." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
