import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseEmployerPortal } from "@/lib/plan";
import { listEmployees } from "@/lib/employees-store";
import { listTimeOffForEmployer } from "@/lib/time-store";
import { isTimeOffStatus } from "@/lib/time-hub";

export const runtime = "nodejs";

/**
 * GET ?status=pending|approved|declined (optional) → the employer's time-off
 * requests, joined with the requesting employee's name/role.
 */
export async function GET(req: Request) {
  const ctx = await employerContext();
  if (!ctx || !canUseEmployerPortal(ctx.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const status = isTimeOffStatus(statusParam) ? statusParam : undefined;

  const [requests, employees] = await Promise.all([listTimeOffForEmployer(ctx.employerId, status), listEmployees(ctx.employerId)]);
  const byId = new Map(employees.map((e) => [e.id, e]));

  const rows = requests.map((r) => {
    const emp = byId.get(r.employeeId);
    return { request: r, employee: emp ? { id: emp.id, name: emp.name, role: emp.role } : null };
  });
  return NextResponse.json({ rows });
}
