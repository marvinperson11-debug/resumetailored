import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { CandidateSidebar } from "@/components/candidate-sidebar";
import { UpgradeFlow } from "@/components/upgrade-flow";
import { getAccess, canUseIndividualPro } from "@/lib/plan";
import { ToolsProvider } from "./components/tools-context";
import { ToolDock } from "./components/tool-dock";
import { ToolHost } from "./components/tool-host";

export default async function CandidateLayout({ children }: { children: ReactNode }) {
  const access = await getAccess();
  const isPro = canUseIndividualPro(access);
  return (
    <ToolsProvider isPro={isPro}>
      <DashboardShell
        sidebar={<CandidateSidebar role={{ plan: access.plan, employerName: access.employerName }} />}
        title="My Career Office"
      >
        {children}
        <UpgradeFlow />
      </DashboardShell>
      {/* Floating tool dock + centered tool modal host live above the shell. */}
      <ToolDock />
      <ToolHost />
    </ToolsProvider>
  );
}
