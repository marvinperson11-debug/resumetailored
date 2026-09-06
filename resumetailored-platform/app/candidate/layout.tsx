import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { CandidateSidebar } from "@/components/candidate-sidebar";
import { UpgradeFlow } from "@/components/upgrade-flow";
import { isPro } from "@/lib/plan";

export default async function CandidateLayout({ children }: { children: ReactNode }) {
  const pro = await isPro();
  return (
    <DashboardShell sidebar={<CandidateSidebar isPro={pro} />} title="My Career Office">
      {children}
      <UpgradeFlow />
    </DashboardShell>
  );
}
