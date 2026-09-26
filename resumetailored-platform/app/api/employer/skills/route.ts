import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { listSkills, createSkill, listEmployeeSkills } from "@/lib/skills-store";
import { normalizeSkillName } from "@/lib/skills-hub";

export const runtime = "nodejs";

/** GET the employer's skill taxonomy + every rated matrix cell. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const [skills, cells] = await Promise.all([listSkills(ctx.employerId), listEmployeeSkills(ctx.employerId)]);
  return NextResponse.json({ skills, cells });
}

/** POST add a skill to the matrix. Body: { name }. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { name?: string };
  const name = normalizeSkillName(b.name);
  if (!name) return NextResponse.json({ error: "Give the skill a name." }, { status: 400 });
  const skill = await createSkill(ctx.employerId, name);
  if (!skill) return NextResponse.json({ error: "Could not add the skill." }, { status: 500 });
  return NextResponse.json({ skill });
}
