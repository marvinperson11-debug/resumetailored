import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { getOpenEntry, clockIn, clockOut, listRecentEntries } from "@/lib/time-store";

export const runtime = "nodejs";

/** GET the employee's clock state: the open entry (if any) + recent entries. */
export async function GET() {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const [open, recent] = await Promise.all([
    getOpenEntry(ctx.employerId, ctx.employeeId),
    listRecentEntries(ctx.employerId, ctx.employeeId, 30),
  ]);
  return NextResponse.json({ open, recent });
}

/** POST { action: "in" | "out", note? } to clock in or out. */
export async function POST(req: Request) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; note?: string };
  const note = typeof b.note === "string" ? b.note : "";

  if (b.action === "out") {
    const entry = await clockOut(ctx.employerId, ctx.employeeId, note);
    if (!entry) return NextResponse.json({ error: "You are not clocked in." }, { status: 400 });
    return NextResponse.json({ entry, open: null });
  }

  // Default / "in".
  const entry = await clockIn(ctx.employerId, ctx.employeeId, note);
  if (!entry) return NextResponse.json({ error: "Could not clock in. Please try again." }, { status: 500 });
  return NextResponse.json({ entry, open: entry });
}
