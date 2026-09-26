import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { listForEmployee, markAllRead } from "@/lib/notifications-store";

export const runtime = "nodejs";

/** POST mark every currently-visible employee notification read. */
export async function POST() {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const items = await listForEmployee(ctx.employerId, ctx.employeeId, ctx.userId, 100);
  await markAllRead(ctx.userId, items.map((i) => i.id));
  return NextResponse.json({ ok: true });
}
