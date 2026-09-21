import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { deleteAvailability } from "@/lib/time-store";

export const runtime = "nodejs";

/** DELETE one of the employee's own availability slots. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const ok = await deleteAvailability(ctx.employerId, ctx.employeeId, id);
  if (!ok) return NextResponse.json({ error: "Could not remove that slot." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
