import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { getEmployee } from "@/lib/employees-store";
import { listCertsForEmployee, createCert } from "@/lib/cert-store";

export const runtime = "nodejs";

/** GET one employee's certifications. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const employeeId = Number(params.id);
  const employee = await getEmployee(ctx.employerId, employeeId);
  if (!employee) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const certs = await listCertsForEmployee(ctx.employerId, employeeId);
  return NextResponse.json({ certs });
}

/** POST add a certification for this employee (employer side). Body:
 *  { name, issuedDate?, expiryDate? }. Attach a file afterward via
 *  POST /api/employer/certs/[id]/file. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can add certifications." }, { status: 403 });
  const employeeId = Number(params.id);
  const employee = await getEmployee(ctx.employerId, employeeId);
  if (!employee) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { name?: string; issuedDate?: string; expiryDate?: string };
  const name = (b.name || "").trim();
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });

  const cert = await createCert(ctx.employerId, employeeId, {
    name,
    issuedDate: b.issuedDate || null,
    expiryDate: b.expiryDate || null,
    addedBy: "employer",
  });
  if (!cert) return NextResponse.json({ error: "Could not add the certification." }, { status: 500 });
  return NextResponse.json({ cert });
}
