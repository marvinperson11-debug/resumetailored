import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { listCertsForEmployee, createCert } from "@/lib/cert-store";

export const runtime = "nodejs";

/** GET the current employee's own certifications. */
export async function GET() {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const certs = await listCertsForEmployee(ctx.employerId, ctx.employeeId);
  return NextResponse.json({ certs });
}

/** POST self-add a certification. Body: { name, issuedDate?, expiryDate? }.
 *  Attach a file afterward via POST /api/employee/certs/[id]/file. */
export async function POST(req: Request) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { name?: string; issuedDate?: string; expiryDate?: string };
  const name = (b.name || "").trim();
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });

  const cert = await createCert(ctx.employerId, ctx.employeeId, {
    name,
    issuedDate: b.issuedDate || null,
    expiryDate: b.expiryDate || null,
    addedBy: "employee",
  });
  if (!cert) return NextResponse.json({ error: "Could not add the certification." }, { status: 500 });
  return NextResponse.json({ cert });
}
