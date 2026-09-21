import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { listAvailability, addAvailability } from "@/lib/time-store";
import { isAvailabilityKind, isHHMM, hhmmToMinutes, parseISODate } from "@/lib/time-hub";

export const runtime = "nodejs";

/** GET the employee's own availability slots. */
export async function GET() {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const slots = await listAvailability(ctx.employerId, ctx.employeeId);
  return NextResponse.json({ slots });
}

/**
 * POST a new availability slot.
 * Body: { kind: "recurring"|"date", weekday?, specificDate?, startTime, endTime, available?, note? }
 */
export async function POST(req: Request) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as {
    kind?: string;
    weekday?: number;
    specificDate?: string;
    startTime?: string;
    endTime?: string;
    available?: boolean;
    note?: string;
  };

  if (!isAvailabilityKind(b.kind)) return NextResponse.json({ error: "Pick recurring or a specific date." }, { status: 400 });
  if (!isHHMM(b.startTime) || !isHHMM(b.endTime))
    return NextResponse.json({ error: "Enter valid start and end times." }, { status: 400 });
  if (hhmmToMinutes(b.endTime) <= hhmmToMinutes(b.startTime))
    return NextResponse.json({ error: "End time must be after the start time." }, { status: 400 });

  if (b.kind === "recurring") {
    if (typeof b.weekday !== "number" || b.weekday < 0 || b.weekday > 6)
      return NextResponse.json({ error: "Pick a day of the week." }, { status: 400 });
  } else {
    if (!b.specificDate || !parseISODate(b.specificDate))
      return NextResponse.json({ error: "Pick a valid date." }, { status: 400 });
  }

  const slot = await addAvailability(ctx.employerId, ctx.employeeId, {
    kind: b.kind,
    weekday: b.kind === "recurring" ? b.weekday : null,
    specificDate: b.kind === "date" ? b.specificDate : null,
    startTime: b.startTime,
    endTime: b.endTime,
    available: b.available !== false,
    note: b.note,
  });
  if (!slot) return NextResponse.json({ error: "Could not save availability." }, { status: 500 });
  return NextResponse.json({ slot });
}
