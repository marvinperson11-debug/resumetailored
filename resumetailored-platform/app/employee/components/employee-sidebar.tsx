"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FileText, MessageSquare, CalendarClock, GraduationCap, BookOpen, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@/components/sign-out-button";

export interface EmployeeNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
}

/** Single source of truth for the employee-portal nav. */
export const EMPLOYEE_NAV: EmployeeNavItem[] = [
  { label: "Home", href: "/employee", icon: Home, exact: true },
  { label: "My documents", href: "/employee/documents", icon: FileText },
  { label: "Messages", href: "/employee/messages", icon: MessageSquare },
  { label: "Time off", href: "/employee/time-off", icon: CalendarClock },
  { label: "My training", href: "/employee/training", icon: GraduationCap },
  { label: "Library", href: "/employee/library", icon: BookOpen },
];

export function isEmployeeNavActive(pathname: string, href: string, exact?: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

/**
 * Employee-portal sidebar — same layout pattern as the employer/candidate
 * sidebars: fixed header, scrollable nav (icon left, violet active state), then
 * a bottom stack with the company name and Sign out. Rendered by DashboardShell
 * in both the desktop rail and the mobile slide-out drawer.
 */
export function EmployeeSidebar({ company, name }: { company: string; name?: string }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border-gold px-6">
        <span className="font-serif text-lg font-medium text-cream">ResumeTailored</span>
        <span className="rounded bg-violet/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet">Portal</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-6">
        {(name || company) && (
          <div className="px-4 pb-2">
            {name && <div className="truncate text-sm font-medium text-cream">{name}</div>}
            {company && <div className="truncate text-xs text-white/50">{company}</div>}
          </div>
        )}
        {EMPLOYEE_NAV.map((n) => {
          const Icon = n.icon;
          const isActive = isEmployeeNavActive(pathname, n.href, n.exact);
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

      <div className="shrink-0 border-t border-border-gold px-3 py-3">
        <SignOutButton className="flex w-full items-center gap-3 rounded-md border-l-2 border-transparent px-4 py-2.5 text-sm text-muted-cream transition-all duration-200 hover:bg-white/5 hover:text-cream" />
      </div>
    </div>
  );
}
