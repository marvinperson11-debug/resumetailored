import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { EmployerSidebar } from "@/components/employer-sidebar";

export default function EmployerLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardShell sidebar={<EmployerSidebar />} title="Acme Corp">
      {children}
    </DashboardShell>
  );
}
