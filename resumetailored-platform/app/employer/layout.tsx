import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import { LockedFeature } from "@/components/locked-feature";
import { getAccess, canUseEmployerPortal, resolveEmployerId } from "@/lib/plan";
import { getEmployerProfile } from "@/lib/employer-store";
import { EmployerTopNav } from "./components/employer-top-nav";
import { OnboardingModal } from "./components/onboarding-modal";

export const dynamic = "force-dynamic";

/**
 * Employer Portal shell — a top navigation bar + full-width content area (a
 * deliberately different layout from the candidate sidebar). Only employer
 * (organization) accounts and their invited employees reach it; everyone else
 * gets the access gate. First-run employers see the onboarding modal until a
 * company profile exists.
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

  return (
    <div className="min-h-screen bg-navy">
      <EmployerTopNav company={company} isAdmin={access.isAdmin} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      {needsOnboarding && <OnboardingModal />}
    </div>
  );
}
