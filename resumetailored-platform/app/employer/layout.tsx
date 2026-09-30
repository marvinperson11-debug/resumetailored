import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import { getTranslations } from "next-intl/server";
import { LockedFeature } from "@/components/locked-feature";
import { DashboardShell } from "@/components/dashboard-shell";
import { NotificationBell } from "@/components/notification-bell";
import { getAccess, canUseEmployerPortal, resolveEmployerId } from "@/lib/plan";
import { videoMonthlyLimit, canUseEmployeesHub, canUseTimeSuite, isScalePlusTier, checkSendAllowance, tierLabel, normalizeTier } from "@/lib/employer-plan";
import { getEmployerProfile } from "@/lib/employer-store";
import { monthlySendCount } from "@/lib/docusign-store";
import { EmployerSidebar } from "./components/employer-sidebar";
import { OnboardingModal } from "./components/onboarding-modal";

export const dynamic = "force-dynamic";

/**
 * Employer Portal shell — the SAME layout as the candidate area
 * (`DashboardShell`): a persistent left sidebar on desktop and a hamburger
 * slide-out drawer on mobile/tablet, so both portals look and behave
 * identically. Only employer (organization) accounts and their invited
 * employees reach it; everyone else gets the access gate. First-run employers
 * see the onboarding modal until a company profile exists.
 */
export default async function EmployerLayout({ children }: { children: ReactNode }) {
  const { userId } = await auth();
  const access = await getAccess();

  if (!canUseEmployerPortal(access)) {
    return (
      <main className="min-h-screen bg-navy px-4 py-10">
        <LockedFeature feature="Employer Portal" variant="employer" />
      </main>
    );
  }

  const employerId = resolveEmployerId(access, userId)!;
  const [profile, sendsUsed] = await Promise.all([getEmployerProfile(employerId), monthlySendCount(employerId)]);
  // Employees join an already-onboarded company, so never block them on setup.
  const needsOnboarding = access.plan === "employer" && !profile;
  const ts = await getTranslations("shell");
  const company = profile?.companyName || ts("yourCompany");
  // Tier NAME for the sidebar badge — Free / Portal / Scale / Corporate. The
  // admin bypass is treated as Corporate everywhere else (checkSendAllowance,
  // isScalePlusTier, …), so it's labeled the same way here.
  const planLabel = access.isAdmin ? "Corporate" : tierLabel(normalizeTier(access.tier));
  // The always-on upgrade path: a live e-sig send counter in the sidebar
  // footer on every page, so upgrading is never discovered only by hitting a
  // wall. Corporate (and the admin bypass, which resolves to Corporate) has
  // unlimited sends — nothing to show, nowhere further to upgrade to.
  const sendAllowance = checkSendAllowance(access, sendsUsed);
  const quota = sendAllowance.limit === Infinity ? null : { used: sendAllowance.used, limit: sendAllowance.limit };
  // Nav items whose whole feature is unavailable at this tier get a lock badge
  // in the sidebar. The real admin bypass (isAdmin, no active preview) never
  // shows locks.
  const lockedHrefs = access.isAdmin
    ? []
    : [
        ...(videoMonthlyLimit(access) === 0 ? ["/employer/scheduler"] : []),
        ...(!canUseEmployeesHub(access) ? ["/employer/employees"] : []),
        ...(!canUseTimeSuite(access) ? ["/employer/schedule", "/employer/timesheets", "/employer/time-off"] : []),
        ...(!isScalePlusTier(access) ? ["/employer/office"] : []),
      ];

  return (
    <DashboardShell
      sidebar={
        <EmployerSidebar
          company={company}
          isAdmin={access.realAdmin || access.isAdmin}
          planLabel={planLabel}
          lockedHrefs={lockedHrefs}
          quota={quota}
        />
      }
      title={company}
      bell={<NotificationBell basePath="/api/employer" />}
    >
      {children}
      {needsOnboarding && <OnboardingModal />}
    </DashboardShell>
  );
}
