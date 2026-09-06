import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { CandidateSidebar } from "@/components/candidate-sidebar";
import { UpgradeFlow } from "@/components/upgrade-flow";
import { getAccess } from "@/lib/plan";

export default async function CandidateLayout({ children }: { children: ReactNode }) {
  const access = await getAccess();
  return (
    <DashboardShell
      sidebar={
        <CandidateSidebar role={{ plan: access.plan, employerName: access.employerName }} />
      }
      title="My Career Office"
    >
      {children}
      <UpgradeFlow />
    </DashboardShell>
  );
}
