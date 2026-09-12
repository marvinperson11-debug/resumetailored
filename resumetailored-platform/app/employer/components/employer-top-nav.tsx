"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Briefcase, Users, UserCog, Settings, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProfileButton } from "@/components/profile-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { AdminViewToggle } from "@/components/admin-view-toggle";
import { SignOutButton } from "@/components/sign-out-button";

const NAV = [
  { label: "Dashboard", href: "/employer", icon: LayoutDashboard, exact: true },
  { label: "Jobs", href: "/employer/jobs", icon: Briefcase },
  { label: "Candidates", href: "/employer/candidates", icon: Users },
  { label: "Team", href: "/employer/team", icon: UserCog },
  { label: "Settings", href: "/employer/settings", icon: Settings },
];

/** Corporate top navigation bar: logo left, section links center, company +
 *  avatar right. Collapses to a hamburger sheet under lg. */
export function EmployerTopNav({ company, isAdmin }: { company: string; isAdmin?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(href + "/"));

  return (
    <header className="sticky top-0 z-40 border-b border-border-gold bg-navy/95 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Left: logo */}
        <Link href="/employer" className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold/15 text-sm font-extrabold tracking-tight text-gold">RT</span>
          <span className="hidden font-serif text-lg font-medium text-cream sm:inline">ResumeTailored</span>
          <span className="hidden rounded bg-gold/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold sm:inline">
            Employer
          </span>
        </Link>

        {/* Center: nav links (desktop) */}
        <nav className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => {
            const Icon = n.icon;
            const on = active(n.href, n.exact);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  on ? "bg-violet/15 text-cream" : "text-muted-cream hover:bg-white/5 hover:text-cream"
                )}
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>

        {/* Right: language + (admin) view toggle + company + avatar */}
        <div className="flex items-center gap-3">
          {isAdmin && <AdminViewToggle />}
          <LanguageSwitcher className="hidden sm:flex" />
          <span className="hidden max-w-[160px] truncate text-sm font-medium text-white/80 md:inline">{company}</span>
          <SignOutButton className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-cream transition-colors hover:bg-white/5 hover:text-cream sm:flex" />
          <ProfileButton />
          <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Menu" className="text-muted-cream lg:hidden">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile nav sheet */}
      {open && (
        <nav className="border-t border-border-gold bg-navy px-4 py-3 lg:hidden">
          {NAV.map((n) => {
            const Icon = n.icon;
            const on = active(n.href, n.exact);
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  on ? "bg-violet/15 text-cream" : "text-muted-cream hover:bg-white/5"
                )}
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
          <SignOutButton className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-cream transition-colors hover:bg-white/5 hover:text-cream sm:hidden" />
        </nav>
      )}
    </header>
  );
}
