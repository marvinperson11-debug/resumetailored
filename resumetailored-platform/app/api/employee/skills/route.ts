import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { listSkillsForEmployee } from "@/lib/skills-store";

export const runtime = "nodejs";

/** GET the signed-in employee's own rated skills — read-only. */
export async function GET() {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const skills = await listSkillsForEmployee(ctx.employerId, ctx.employeeId);
  return NextResponse.json({ skills });
}
