"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Briefcase, Users, MessageSquare, Star, CalendarClock, Globe, UserCog, Settings, Building2, FileSignature, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminViewToggle } from "@/components/admin-view-toggle";
import { SignOutButton } from "@/components/sign-out-button";

export interface EmployerNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
}

/** Single source of truth for the employer nav. */
export const EMPLOYER_NAV: EmployerNavItem[] = [
  { label: "Dashboard", href: "/employer", icon: LayoutDashboard, exact: true },
  { label: "Hire", href: "/employer/jobs", icon: Briefcase },
  { label: "Candidates", href: "/employer/candidates", icon: Users },
  { label: "Messages", href: "/employer/messages", icon: MessageSquare },
  { label: "Shortlists", href: "/employer/shortlists", icon: Star },
  { label: "Scheduler", href: "/employer/scheduler", icon: CalendarClock },
  { label: "Offer Letters", href: "/employer/docusign", icon: FileSignature },
  { label: "Career Site", href: "/employer/career-site", icon: Globe },
  { label: "Team", href: "/employer/team", icon: UserCog },
  { label: "Settings", href: "/employer/settings", icon: Settings },
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
export function EmployerSidebar({ company, isAdmin, planLabel = "Portal" }: { company: string; isAdmin?: boolean; planLabel?: string }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border-gold px-6">
        <span className="font-serif text-lg font-medium text-cream">ResumeTailored</span>
        <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">Employer</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-6">
        {company && <div className="truncate px-4 pb-2 text-xs font-medium text-white/50">{company}</div>}
        {EMPLOYER_NAV.map((n) => {
          const Icon = n.icon;
          const isActive = isEmployerNavActive(pathname, n.href, n.exact);
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
              <span className="flex-1">{n.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom: admin view toggle (admin only), above Sign out. */}
      {isAdmin && (
        <div className="shrink-0 border-t border-border-gold px-3 py-3">
          <AdminViewToggle />
        </div>
      )}

      <div className="shrink-0 border-t border-border-gold px-3 py-3">
        <SignOutButton className="flex w-full items-center gap-3 rounded-md border-l-2 border-transparent px-4 py-2.5 text-sm text-muted-cream transition-all duration-200 hover:bg-white/5 hover:text-cream" />
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border-gold px-6 py-4">
        <Building2 className="h-4 w-4 text-gold" />
        <span className="text-xs font-medium text-gold">{planLabel}</span>
      </div>
    </div>
  );
}
