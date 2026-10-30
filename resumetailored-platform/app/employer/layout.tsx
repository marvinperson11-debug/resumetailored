import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import { getTranslations } from "next-intl/server";
import { LockedFeature } from "@/components/locked-feature";
import { DashboardShell } from "@/components/dashboard-shell";
import { NotificationBell } from "@/components/notification-bell";
import { getAccess, canUseEmployerPortal, resolveEmployerId } from "@/lib/plan";
import { planBadgeFor } from "@/lib/plan-badge";
import { videoMonthlyLimit, canUseEmployeesHub, canUseTimeSuite, isScalePlusTier, canBrowseTalentPool, checkSendAllowance, tierLabel } from "@/lib/employer-plan";
import { getEmployerProfile } from "@/lib/employer-store";
import { monthlySendCount } from "@/lib/docusign-store";
import { PreviewDataBanner } from "@/components/preview-data-banner";
import { EmployerSidebar } from "./components/employer-sidebar";
import { OnboardingModal } from "./components/onboarding-modal";
import { EmployerDemoProvider } from "./components/demo/demo-provider";
import { DemoBanner } from "./components/demo/demo-banner";
import { EmployerDraftRestorer } from "./components/demo/draft-restorer";

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

  // Anonymous employer taste: a signed-OUT visitor gets the real portal chrome around demo fixtures
  // (lib/employer-demo.ts) — never an employer workspace. No store is read here, so there is nothing
  // real for this branch to leak; middleware.ts only lets the three taste pages through to it.
  if (!userId) {
    const td = await getTranslations("employerDemo");
    return (
      <EmployerDemoProvider>
        <DashboardShell sidebar={<EmployerSidebar demo company={td("companyName")} planLabel="free" />} title={td("companyName")}>
          <DemoBanner />
          {children}
        </DashboardShell>
      </EmployerDemoProvider>
    );
  }

  const access = await getAccess();

  if (!canUseEmployerPortal(access)) {
    return (
      <main className="min-h-screen bg-navy px-4 py-10">
        <PreviewDataBanner access={access} side="employer" />
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
  // Tier NAME for the sidebar badge — Free / Portal / Scale / Corporate — from
  // the same function Settings → "Current plan" uses, so the two cannot
  // disagree. (It used to hardcode "Corporate" for the admin bypass while
  // Settings showed the stored tier, i.e. Free. Entitlements for the admin are
  // still unlimited — that is decided by access.isAdmin in the gates, not here.)
  const employerBadge = planBadgeFor("employer", access);
  const planLabel = tierLabel(employerBadge && employerBadge.side === "employer" ? employerBadge.tier : "free");
  // The always-on upgrade path: a live e-sig send counter in the sidebar
  // footer on every page, so upgrading is never discovered only by hitting a
  // wall. Corporate (and the admin bypass, which resolves to Corporate) has
  // unlimited sends — nothing to show, nowhere further to upgrade to.
  const sendAllowance = checkSendAllowance(access, sendsUsed);
  const quota = sendAllowance.limit === Infinity ? null : { used: sendAllowance.used, limit: sendAllowance.limit };
  // Nav items whose whole feature is unavailable at this tier get a lock badge
  // in the sidebar. The real admin bypass (isAdmin, no active preview) never
  // shows locks. The Assistant tab is deliberately NOT in this list at all
  // any more (Taylor Combined Build v5, Section E.1): Free now gets a real
  // assistant experience (explainer mode, with the one-shot job-post
  // exception — see app/employer/assistant/page.tsx), so there is nothing
  // to lock there for any tier.
  const lockedHrefs = access.isAdmin
    ? []
    : [
        ...(videoMonthlyLimit(access) === 0 ? ["/employer/scheduler"] : []),
        ...(!canUseEmployeesHub(access) ? ["/employer/employees"] : []),
        ...(!canUseTimeSuite(access) ? ["/employer/schedule", "/employer/timesheets", "/employer/time-off"] : []),
        ...(!isScalePlusTier(access) ? ["/employer/office"] : []),
        ...(!canBrowseTalentPool(access) ? ["/employer/talent-pool"] : []),
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
      <PreviewDataBanner access={access} side="employer" />
      {children}
      {needsOnboarding && <OnboardingModal />}
      <EmployerDraftRestorer />
    </DashboardShell>
  );
}
