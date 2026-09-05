import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { CandidateSidebar } from "@/components/candidate-sidebar";

export default function CandidateLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardShell sidebar={<CandidateSidebar />} title="My Career Office">
      {children}
    </DashboardShell>
  );
}
