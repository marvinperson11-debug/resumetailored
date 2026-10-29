import { NextResponse } from "next/server";
import { requireEmployerId, employerContext } from "@/lib/employer-auth";
import { getApplicant, updateApplicant } from "@/lib/employer-store";
import { isApplicantStatus } from "@/lib/employer-ai";
import { isFreeTier, getFreeTierState, employeeAddAllowed, nonOwnerEmployeeCount, requireTierFor } from "@/lib/employer-free-tier";
import { listEmployees, createEmployee } from "@/lib/employees-store";

export const runtime = "nodejs";

/** GET a single applicant (with match analysis + resume). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const applicant = await getApplicant(employerId, id);
  if (!applicant) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ applicant });
}

/** PATCH — change status and/or notes. On the Free plan, moving a candidate
 *  to "hired" converts them into the one employee slot (Section E.4) —
 *  automatic, because Free's own Employees Hub tab stays Portal-gated
 *  (unchanged); hiring here is the only route into that slot. A second
 *  non-owner hire beyond the one-employee cap is refused with a graduation
 *  message instead of silently creating a second employee row. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  const employerId = ctx?.employerId || null;
  if (!ctx || !employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as { status?: string; notes?: string };
  const patch: { status?: import("@/lib/employer-ai").ApplicantStatus; notes?: string } = {};
  if (b.status !== undefined) {
    if (!isApplicantStatus(b.status)) return NextResponse.json({ error: "bad status" }, { status: 400 });
    patch.status = b.status;
  }
  if (b.notes !== undefined) patch.notes = String(b.notes);
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const applicant = await getApplicant(employerId, id);
  if (!applicant) return NextResponse.json({ error: "Could not update the applicant." }, { status: 500 });

  const isFree = isFreeTier(ctx.access);
  const hiring = patch.status === "hired" && applicant.status !== "hired";
  if (hiring && isFree) {
    const [employees, freeState] = await Promise.all([listEmployees(employerId), getFreeTierState(employerId)]);
    const nonOwnerNow = nonOwnerEmployeeCount(employees.map((e) => e.clerkUserId || null), employerId);
    const gate = requireTierFor(ctx.access, "employee_add", `You've hired a candidate for "${applicant.jobTitle || "your job"}"`, employeeAddAllowed(nonOwnerNow, freeState.employeesNonOwner));
    if (!gate.allowed) return NextResponse.json({ error: gate.message, code: "free_tier_graduation" }, { status: 402 });
  }

  const ok = await updateApplicant(employerId, id, patch);
  if (!ok) return NextResponse.json({ error: "Could not update the applicant." }, { status: 500 });
  if (hiring && isFree) {
    await createEmployee(employerId, { name: applicant.name, email: applicant.email, role: applicant.jobTitle || "", status: "active" });
  }
  const updated = await getApplicant(employerId, id);
  return NextResponse.json({ ok: true, applicant: updated });
}
