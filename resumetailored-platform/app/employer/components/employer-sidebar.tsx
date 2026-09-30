"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutDashboard, Briefcase, Users, UserCheck, MessageSquare, Star, CalendarClock, CalendarDays, Clock, Plane, Globe, UserCog, Settings, Building2, FileSignature, FolderOpen, Calculator, Lock, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminViewToggle } from "@/components/admin-view-toggle";
import { PlanPreviewSwitcher } from "@/components/plan-preview-switcher";
import { SignOutButton } from "@/components/sign-out-button";

export interface EmployerNavItem {
  /** An i18n key under the "employerNav" namespace, resolved at render —
   *  same convention as CandidateSidebar's `navItems`. */
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
}

/** Single source of truth for the employer nav. */
export const EMPLOYER_NAV: EmployerNavItem[] = [
  { label: "dashboard", href: "/employer", icon: LayoutDashboard, exact: true },
  { label: "hire", href: "/employer/jobs", icon: Briefcase },
  { label: "candidates", href: "/employer/candidates", icon: Users },
  { label: "messages", href: "/employer/messages", icon: MessageSquare },
  { label: "shortlists", href: "/employer/shortlists", icon: Star },
  { label: "scheduler", href: "/employer/scheduler", icon: CalendarClock },
  { label: "eSignatures", href: "/employer/docusign", icon: FileSignature },
  { label: "documents", href: "/employer/documents", icon: FolderOpen },
  { label: "office", href: "/employer/office", icon: Calculator },
  { label: "employees", href: "/employer/employees", icon: UserCheck },
  { label: "schedule", href: "/employer/schedule", icon: CalendarDays },
  { label: "timesheets", href: "/employer/timesheets", icon: Clock },
  { label: "timeOff", href: "/employer/time-off", icon: Plane },
  { label: "careerSite", href: "/employer/career-site", icon: Globe },
  { label: "team", href: "/employer/team", icon: UserCog },
  { label: "settings", href: "/employer/settings", icon: Settings },
];

export function isEmployerNavActive(pathname: string, href: string, exact?: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

/**
 * Employer sidebar — same layout pattern as the candidate sidebar
 * (`CandidateSidebar`): a fixed header, a scrollable nav (icon left, gold
 * left-border on the active item), then a bottom stack of the admin
 * Candidate/Employer toggle (admin only), Sign out, and a plan badge. Rendered
 * by `DashboardShell` in both the persistent desktop rail and the mobile
 * slide-out drawer, so the two portals look and behave identically.
 */
export function EmployerSidebar({
  company,
  isAdmin,
  planLabel = "Portal",
  lockedHrefs = [],
  quota,
}: {
  company: string;
  isAdmin?: boolean;
  planLabel?: string;
  /** Nav hrefs whose feature isn't available at the current (or previewed)
   *  tier — rendered with a small lock badge instead of blocking the link
   *  entirely, since the page itself shows the real upgrade prompt. */
  lockedHrefs?: string[];
  /** The always-on upgrade path (shell-level, every page): a quiet one-line
   *  usage readout + upgrade link in the sidebar footer, so a Free/Portal/
   *  Scale employer never has to hit a wall to discover they can upgrade.
   *  `limit` is always a real number here — Corporate (the only unlimited
   *  tier) omits `quota` entirely, since there's nowhere further to go. */
  quota?: { used: number; limit: number } | null;
}) {
  const pathname = usePathname();
  const t = useTranslations("employerNav");
  const tUi = useTranslations("employerUi");
  // `planLabel` arrives from the server as the English tier name; map the known
  // tiers to their translated names and pass anything else through untouched.
  const tierKey = (planLabel || "").toLowerCase();
  const tierName = ["free", "portal", "scale", "corporate"].includes(tierKey) ? tUi(`tierNames.${tierKey}`) : planLabel;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border-gold px-6">
        <span className="font-serif text-lg font-medium text-cream">ResumeTailored</span>
        <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">{t("badge")}</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-6">
        {company && (
          <div
            className="line-clamp-2 break-words px-4 pb-2 text-xs font-medium leading-snug text-white/50"
            title={company}
          >
            {company}
          </div>
        )}
        {EMPLOYER_NAV.map((n) => {
          const Icon = n.icon;
          const isActive = isEmployerNavActive(pathname, n.href, n.exact);
          const locked = lockedHrefs.includes(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "flex w-full items-center gap-3 rounded-md border-l-2 px-4 py-3 text-sm transition-all duration-200",
                isActive
                  ? "border-violet bg-violet/10 font-medium text-violet shadow-[0_0_22px_rgba(194,135,11,0.28)]"
                  : "border-transparent text-muted-cream hover:bg-white/5"
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span className="flex-1">{t(n.label)}</span>
              {locked && <Lock className="ml-auto h-3.5 w-3.5 shrink-0 text-gold" aria-label={t("upgradeRequired")} />}
            </Link>
          );
        })}
      </nav>

      {/* Bottom: admin view toggle + plan-preview switcher (admin only). */}
      {isAdmin && (
        <div className="shrink-0 border-t border-border-gold px-3 py-3">
          <AdminViewToggle />
          <PlanPreviewSwitcher />
        </div>
      )}

      <div className="shrink-0 border-t border-border-gold px-3 py-3">
        <SignOutButton className="flex w-full items-center gap-3 rounded-md border-l-2 border-transparent px-4 py-2.5 text-sm text-muted-cream transition-all duration-200 hover:bg-white/5 hover:text-cream" />
      </div>

      {quota ? (
        <a
          href="https://resumetailored.com/for-employers"
          className="flex shrink-0 items-center gap-2 border-t border-border-gold px-6 py-4 transition-colors hover:bg-white/5"
        >
          <Building2 className="h-4 w-4 shrink-0 text-gold" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-gold">{t("planName", { plan: tierName })}</span>
            <span className="block text-[11px] text-white/45">{t("sendsUsed", { used: quota.used, limit: quota.limit })}</span>
          </span>
        </a>
      ) : (
        <div className="flex shrink-0 items-center gap-2 border-t border-border-gold px-6 py-4">
          <Building2 className="h-4 w-4 text-gold" />
          <span className="text-xs font-medium text-gold">{tierName}</span>
        </div>
      )}
    </div>
  );
}
