import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { getEmployee } from "@/lib/employees-store";
import { setEmployeeSkillLevel } from "@/lib/skills-store";
import { isValidSkillLevel } from "@/lib/skills-hub";

export const runtime = "nodejs";

/** PATCH set (or, with level:null, clear) this employee's level for one
 *  skill. Body: { skillId, level: 1-5 | null }. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const employeeId = Number(params.id);
  const employee = await getEmployee(ctx.employerId, employeeId);
  if (!employee) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { skillId?: number; level?: number | null };
  const skillId = Number(b.skillId);
  if (!Number.isFinite(skillId) || skillId <= 0) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (b.level !== null && !isValidSkillLevel(b.level)) return NextResponse.json({ error: "Level must be 1-5." }, { status: 400 });

  const ok = await setEmployeeSkillLevel(ctx.employerId, employeeId, skillId, b.level === null ? null : b.level);
  if (!ok) return NextResponse.json({ error: "Could not update the skill." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
