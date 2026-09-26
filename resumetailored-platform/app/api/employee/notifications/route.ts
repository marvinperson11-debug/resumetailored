import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { listForEmployee } from "@/lib/notifications-store";

export const runtime = "nodejs";

/** GET the employee bell's recent notifications for their own portal. */
export async function GET() {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const items = await listForEmployee(ctx.employerId, ctx.employeeId, ctx.userId);
  return NextResponse.json({ items });
}
