import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import { LockedFeature } from "@/components/locked-feature";
import { DashboardShell } from "@/components/dashboard-shell";
import { getAccess, canUseEmployerPortal, resolveEmployerId } from "@/lib/plan";
import { getEmployerProfile } from "@/lib/employer-store";
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
  const profile = await getEmployerProfile(employerId);
  // Employees join an already-onboarded company, so never block them on setup.
  const needsOnboarding = access.plan === "employer" && !profile;
  const company = profile?.companyName || "Your company";
  // Tier NAME only for the sidebar badge — Portal / Scale / Corporate.
  const planLabel = access.tier === "scale" ? "Scale" : access.tier === "corporate" ? "Corporate" : "Portal";

  return (
    <DashboardShell sidebar={<EmployerSidebar company={company} isAdmin={access.isAdmin} planLabel={planLabel} />} title={company}>
      {children}
      {needsOnboarding && <OnboardingModal />}
    </DashboardShell>
  );
}
