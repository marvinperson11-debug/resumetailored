import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { employeeContext } from "@/lib/employee-auth";
import { getAccess, isStaffEmployee } from "@/lib/plan";
import { getEmployerProfile } from "@/lib/employer-store";
import { EmployeeSidebar } from "./components/employee-sidebar";
import { EmployeePortalGate } from "./components/portal-gate";

export const dynamic = "force-dynamic";

/**
 * Employee Portal shell — the SAME DashboardShell as the employer/candidate
 * areas, scoped to a single workforce employee. Only an accepted, Clerk-linked
 * workforce employee (`isStaffEmployee`) reaches it. Everyone else sees the
 * Employee Portal gate — an explainer for invited team members, NOT the employer
 * upsell (this door isn't for employers). A signed-in staff account whose row
 * can't be resolved gets the "contact your employer" variant instead.
 */
export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const ctx = await employeeContext();

  if (!ctx) {
    // Distinguish a misconfigured staff account (metadata says staff, but the
    // employee row didn't resolve) from a non-member who simply landed here.
    const access = await getAccess();
    const mode = isStaffEmployee(access) ? "misconfigured" : "explain";
    return <EmployeePortalGate mode={mode} />;
  }

  const profile = await getEmployerProfile(ctx.employerId);
  const company = profile?.companyName || ctx.access.employerName || "Your workplace";

  return (
    <DashboardShell sidebar={<EmployeeSidebar company={company} name={ctx.employee.name} />} title={company}>
      {children}
    </DashboardShell>
  );
}
