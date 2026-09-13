"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Briefcase, Users, MessageSquare, Star, CalendarClock, UserCog, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminViewToggle } from "@/components/admin-view-toggle";
import { SignOutButton } from "@/components/sign-out-button";

export interface EmployerNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
}

/** Single source of truth for the employer nav — used by both the desktop top
 *  bar and the mobile slide-out sidebar. */
export const EMPLOYER_NAV: EmployerNavItem[] = [
  { label: "Dashboard", href: "/employer", icon: LayoutDashboard, exact: true },
  { label: "Jobs", href: "/employer/jobs", icon: Briefcase },
  { label: "Candidates", href: "/employer/candidates", icon: Users },
  { label: "Messages", href: "/employer/messages", icon: MessageSquare },
  { label: "Shortlists", href: "/employer/shortlists", icon: Star },
  { label: "Scheduler", href: "/employer/scheduler", icon: CalendarClock },
  { label: "Team", href: "/employer/team", icon: UserCog },
  { label: "Settings", href: "/employer/settings", icon: Settings },
];

export function isEmployerNavActive(pathname: string, href: string, exact?: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

/**
 * Full vertical employer navigation, rendered inside the mobile slide-out
 * drawer (and reusable elsewhere). Admin sees the Candidate/Employer view
 * toggle at the bottom, above Sign out. `onNavigate` lets the drawer close
 * itself when a link is tapped.
 */
export function EmployerSidebar({ company, isAdmin, onNavigate }: { company: string; isAdmin?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border-gold px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold/15 text-sm font-extrabold tracking-tight text-gold">RT</span>
        <span className="font-serif text-lg font-medium text-cream">ResumeTailored</span>
        <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">Employer</span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
        {company && <div className="truncate px-3 pb-2 text-xs font-medium text-white/50">{company}</div>}
        {EMPLOYER_NAV.map((n) => {
          const Icon = n.icon;
          const on = isEmployerNavActive(pathname, n.href, n.exact);
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md border-l-2 px-4 py-2.5 text-sm transition-all duration-200",
                on ? "border-violet bg-violet/10 font-medium text-violet" : "border-transparent text-muted-cream hover:bg-white/5 hover:text-cream"
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {n.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom: admin view toggle (admin only) + sign out */}
      <div className="shrink-0 space-y-2 border-t border-border-gold px-3 py-3">
        {isAdmin && <AdminViewToggle />}
        <SignOutButton className="flex w-full items-center gap-3 rounded-md border-l-2 border-transparent px-4 py-2.5 text-sm text-muted-cream transition-all duration-200 hover:bg-white/5 hover:text-cream" />
      </div>
    </div>
  );
}
