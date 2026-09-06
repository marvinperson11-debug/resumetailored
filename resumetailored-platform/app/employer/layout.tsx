import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { EmployerSidebar } from "@/components/employer-sidebar";
import { LockedFeature } from "@/components/locked-feature";
import { getAccess, isEmployer } from "@/lib/plan";

export default async function EmployerLayout({ children }: { children: ReactNode }) {
  const access = await getAccess();
  const tierLabel = access.tier
    ? access.tier.charAt(0).toUpperCase() + access.tier.slice(1)
    : "Portal";

  // Strict role segregation: only employer (organization) accounts reach the
  // Employer Portal. Individuals (free/pro/employee) are blocked.
  if (!isEmployer(access)) {
    return (
      <DashboardShell sidebar={<EmployerSidebar />} title="Employer Portal">
        <LockedFeature feature="Employer Portal" variant="employer" />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell sidebar={<EmployerSidebar tierLabel={tierLabel} />} title="Employer Portal">
      {children}
    </DashboardShell>
  );
}
