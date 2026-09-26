import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseEmployerPortal } from "@/lib/plan";
import { setTimeOffStatus, updateTimeOffDates } from "@/lib/time-store";
import { isTimeOffStatus, parseISODate, timeOffRangeLabel } from "@/lib/time-hub";
import { logActivityForEmployee } from "@/lib/notifications-store";

export const runtime = "nodejs";

/** POST { status: "approved"|"declined"|"pending", note? } → the employer's
 *  decision on one time-off request. An approved request surfaces on the
 *  schedule for its dates. Also used to "withdraw" an approved request from
 *  the schedule grid (status: "declined") — same operation as a decline, just
 *  reached from a different surface. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx || !canUseEmployerPortal(ctx.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as { status?: string; note?: string };
  if (!isTimeOffStatus(b.status)) return NextResponse.json({ error: "bad status" }, { status: 400 });

  const request = await setTimeOffStatus(ctx.employerId, id, b.status, b.note || "", ctx.userId);
  if (!request) return NextResponse.json({ error: "Could not update the request." }, { status: 400 });

  if (b.status === "approved" || b.status === "declined") {
    logActivityForEmployee(ctx.employerId, request.employeeId, {
      eventType: "time_off_decided",
      title: `Your time off (${timeOffRangeLabel(request)}) was ${b.status}`,
      link: "/employee/time-off",
    }).catch(() => {});
  }

  return NextResponse.json({ request });
}

/** PATCH { startDate, endDate } → edit a request's date range (e.g. from the
 *  schedule grid, 4 days of vacation trimmed to 3). Status/kind/reason are
 *  untouched. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx || !canUseEmployerPortal(ctx.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as { startDate?: string; endDate?: string };
  if (!b.startDate || !parseISODate(b.startDate)) return NextResponse.json({ error: "Pick a valid start date." }, { status: 400 });
  if (!b.endDate || !parseISODate(b.endDate)) return NextResponse.json({ error: "Pick a valid end date." }, { status: 400 });
  if (b.endDate < b.startDate) return NextResponse.json({ error: "The end date can't be before the start date." }, { status: 400 });

  const request = await updateTimeOffDates(ctx.employerId, id, { startDate: b.startDate, endDate: b.endDate });
  if (!request) return NextResponse.json({ error: "Could not update the dates." }, { status: 400 });
  return NextResponse.json({ request });
}
