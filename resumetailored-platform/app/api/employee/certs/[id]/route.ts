import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { getCert, deleteCert } from "@/lib/cert-store";

export const runtime = "nodejs";

/** DELETE one of the employee's own self-added certifications (never one the
 *  employer added — that stays theirs to manage). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  const cert = await getCert(ctx.employerId, id);
  if (!cert || cert.employeeId !== ctx.employeeId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (cert.addedBy !== "employee") return NextResponse.json({ error: "Only your employer can remove this one." }, { status: 403 });
  const ok = await deleteCert(ctx.employerId, id);
  return NextResponse.json({ ok });
}
