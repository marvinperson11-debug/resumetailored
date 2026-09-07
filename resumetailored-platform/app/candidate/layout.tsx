import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { CandidateSidebar } from "@/components/candidate-sidebar";
import { UpgradeFlow } from "@/components/upgrade-flow";
import { getAccess, canUseIndividualPro } from "@/lib/plan";
import { ToolsProvider } from "./components/tools-context";
import { ToolHost } from "./components/tool-host";

export default async function CandidateLayout({ children }: { children: ReactNode }) {
  const access = await getAccess();
  const isPro = canUseIndividualPro(access);
  return (
    <ToolsProvider isPro={isPro}>
      {/* Cursive script faces for the signature feature (live preview). The PDF
          print window loads the same faces itself. Loaded here (not via _document,
          which the App Router doesn't use) so it's scoped to the candidate area. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&family=Great+Vibes&display=swap"
        rel="stylesheet"
      />
      <DashboardShell
        sidebar={<CandidateSidebar role={{ plan: access.plan, employerName: access.employerName }} />}
        title="My Career Office"
      >
        {children}
        <UpgradeFlow />
      </DashboardShell>
      {/* Centered tool modal host lives above the shell. The old floating dock
          was removed — navigation is sidebar-only now (FIX 2). */}
      <ToolHost />
    </ToolsProvider>
  );
}
