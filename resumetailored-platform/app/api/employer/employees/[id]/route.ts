import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { getEmployee, updateEmployee, deleteEmployee } from "@/lib/employees-store";
import { listAcknowledgmentsForEmployee, listTrainingDocs } from "@/lib/training-store";
import { isEmployeeStatus } from "@/lib/employee-hub";

export const runtime = "nodejs";

/** GET one employee + their acknowledgment checklist (joined to each doc). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  const employee = await getEmployee(ctx.employerId, id);
  if (!employee) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [acks, docs] = await Promise.all([
    listAcknowledgmentsForEmployee(ctx.employerId, id),
    listTrainingDocs(ctx.employerId),
  ]);
  const docMap = new Map(docs.map((d) => [d.id, d] as const));
  const checklist = acks
    .map((ack) => ({ ack, doc: docMap.get(ack.trainingDocId) || null }))
    .filter((r) => r.doc);
  return NextResponse.json({ employee, checklist });
}

/** PATCH edit an employee (owner only). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can edit employees." }, { status: 403 });
  const id = Number(params.id);

  const b = (await req.json().catch(() => ({}))) as { name?: string; email?: string; role?: string; startDate?: string; status?: string };
  const employee = await updateEmployee(ctx.employerId, id, {
    name: b.name,
    email: b.email,
    role: b.role,
    startDate: b.startDate,
    status: isEmployeeStatus(b.status) ? b.status : undefined,
  });
  if (!employee) return NextResponse.json({ error: "Could not update the employee." }, { status: 400 });
  return NextResponse.json({ employee });
}

/** DELETE an employee (owner only). Their acknowledgments cascade. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can remove employees." }, { status: 403 });
  const ok = await deleteEmployee(ctx.employerId, Number(params.id));
  return NextResponse.json({ ok });
}
