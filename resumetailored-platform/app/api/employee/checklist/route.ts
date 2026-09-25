import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { getLatestEmployeeChecklist } from "@/lib/checklist-store";

export const runtime = "nodejs";

/** GET the current employee's own onboarding checklist, read-only. */
export async function GET() {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const checklist = await getLatestEmployeeChecklist(ctx.employerId, ctx.employeeId);
  return NextResponse.json({ checklist });
}
