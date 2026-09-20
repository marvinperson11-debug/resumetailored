import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { listEmployees, createEmployee, listRoles } from "@/lib/employees-store";
import { isEmployeeStatus, type EmployeeStatus } from "@/lib/employee-hub";

export const runtime = "nodejs";

/** GET the employer's employees (newest first) + the distinct roles in use. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const [employees, roles] = await Promise.all([listEmployees(ctx.employerId), listRoles(ctx.employerId)]);
  return NextResponse.json({ employees, roles });
}

/** POST add an employee. Owner (or admin) only. Prefilled from applicant data by
 *  the "Add as employee" lifecycle hook on the candidate profile. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can add employees." }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as {
    name?: string;
    email?: string;
    role?: string;
    startDate?: string;
    status?: string;
  };
  const name = (b.name || "").trim();
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });

  const employee = await createEmployee(ctx.employerId, {
    name,
    email: b.email,
    role: b.role,
    startDate: b.startDate,
    status: (isEmployeeStatus(b.status) ? b.status : "active") as EmployeeStatus,
  });
  if (!employee) return NextResponse.json({ error: "Could not add the employee. Is the database configured?" }, { status: 500 });
  return NextResponse.json({ employee });
}
