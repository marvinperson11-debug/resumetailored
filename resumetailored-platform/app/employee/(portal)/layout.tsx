import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { NotificationBell } from "@/components/notification-bell";
import { employeeContext } from "@/lib/employee-auth";
import { getAccess, isStaffEmployee } from "@/lib/plan";
import { getEmployerProfile } from "@/lib/employer-store";
import { EmployeeSidebar } from "../components/employee-sidebar";
import { EmployeePortalGate } from "../components/portal-gate";

export const dynamic = "force-dynamic";

/**
 * Employee Portal shell — the SAME DashboardShell as the employer/candidate
 * areas, scoped to a single workforce employee. Only an accepted, Clerk-linked
 * workforce employee (`isStaffEmployee`) reaches it. Everyone else sees the
 * Employee Portal gate — an explainer for invited team members, NOT the employer
 * upsell (this door isn't for employers). A signed-in staff account whose row
 * can't be resolved gets the "contact your employer" variant instead.
 *
 * This layout wraps ONLY the `(portal)` route group. The invite-acceptance page
 * (`/employee/accept`) lives OUTSIDE the group on purpose, so it is never
 * short-circuited by this staff-only gate — an anonymous invitee must reach its
 * own sign-in redirect + code-entry step (that short-circuit was the bug where
 * the invite link dead-ended on the explainer). Middleware bounces anonymous
 * visitors away from every `/employee` route except `/accept`, so by the time
 * this gate renders the explainer the caller is always signed in.
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
    <DashboardShell
      sidebar={<EmployeeSidebar company={company} name={ctx.employee.name} />}
      title={company}
      bell={<NotificationBell basePath="/api/employee" />}
    >
      {children}
    </DashboardShell>
  );
}
