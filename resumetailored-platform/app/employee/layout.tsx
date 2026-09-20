import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { LockedFeature } from "@/components/locked-feature";
import { employeeContext } from "@/lib/employee-auth";
import { getEmployerProfile } from "@/lib/employer-store";
import { EmployeeSidebar } from "./components/employee-sidebar";

export const dynamic = "force-dynamic";

/**
 * Employee Portal shell — the SAME DashboardShell as the employer/candidate
 * areas, scoped to a single workforce employee. Only an accepted, Clerk-linked
 * workforce employee (`isStaffEmployee`) reaches it; everyone else — including
 * the employer owner and invited recruiters — gets the access gate.
 */
export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const ctx = await employeeContext();

  if (!ctx) {
    return (
      <main className="min-h-screen bg-navy px-4 py-10">
        <LockedFeature feature="Employee Portal" variant="employer" />
      </main>
    );
  }

  const profile = await getEmployerProfile(ctx.employerId);
  const company = profile?.companyName || ctx.access.employerName || "Your workplace";

  return (
    <DashboardShell sidebar={<EmployeeSidebar company={company} name={ctx.employee.name} />} title={company}>
      {children}
    </DashboardShell>
  );
}
