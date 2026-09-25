import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { getEmployee } from "@/lib/employees-store";
import { getLatestEmployeeChecklist, startEmployeeChecklist } from "@/lib/checklist-store";

export const runtime = "nodejs";

/** GET the employee's current onboarding checklist (their most recently
 *  started one), or { checklist: null } if none has been started. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const employeeId = Number(params.id);
  const employee = await getEmployee(ctx.employerId, employeeId);
  if (!employee) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const checklist = await getLatestEmployeeChecklist(ctx.employerId, employeeId);
  return NextResponse.json({ checklist });
}

/** POST start a checklist for this employee from a template. Body: { templateId }. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can start a checklist." }, { status: 403 });
  const employeeId = Number(params.id);
  const employee = await getEmployee(ctx.employerId, employeeId);
  if (!employee) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { templateId?: number };
  const templateId = Number(b.templateId);
  if (!Number.isFinite(templateId)) return NextResponse.json({ error: "Pick a template." }, { status: 400 });

  const checklist = await startEmployeeChecklist(ctx.employerId, employeeId, templateId);
  if (!checklist) return NextResponse.json({ error: "Could not start the checklist." }, { status: 400 });
  return NextResponse.json({ checklist });
}
