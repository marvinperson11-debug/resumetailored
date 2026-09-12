"use client";

import { useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ProfileButton } from "./profile-button";
import { LanguageSwitcher } from "./language-switcher";
import { AdminViewToggle } from "./admin-view-toggle";

interface DashboardShellProps {
  sidebar: ReactNode;
  /** Label shown in the top bar (company name or the career-office label). */
  title: string;
  children: ReactNode;
  /** The hardcoded admin sees a Candidate/Employer view toggle. */
  isAdmin?: boolean;
}

/** Gold "RT" monogram used in the top bar. */
function RTLogo() {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold/15 text-sm font-extrabold tracking-tight text-gold">RT</span>
      <span className="hidden font-serif text-sm font-medium text-cream sm:inline">ResumeTailored</span>
    </span>
  );
}

export function DashboardShell({ sidebar, title, children, isAdmin }: DashboardShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const t = useTranslations("topbar");

  return (
    <div className="min-h-screen">
      {/* Fixed sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[260px] border-r border-border-gold bg-navy lg:block">
        {sidebar}
      </aside>

      {/* Mobile slide-out drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy/70" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 w-[260px] border-r border-border-gold bg-navy">
            <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="absolute right-3 top-4 z-10 text-muted-cream transition-colors hover:text-cream">
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      <div className="lg:pl-[260px]">
        {/* Top bar: RT logo (left) · language switcher (center) · admin toggle + avatar (right) */}
        <header className="relative flex h-16 items-center justify-between gap-3 border-b border-border-gold bg-white/5 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setDrawerOpen(true)} aria-label={t("menu")} className="text-muted-cream transition-colors hover:text-cream lg:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <RTLogo />
            <span className="hidden text-xs text-muted-cream md:inline">· {title}</span>
          </div>

          {/* Centered language switcher (absolute so it's truly centered) */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <LanguageSwitcher />
          </div>

          <div className="flex items-center gap-3">
            {isAdmin && <AdminViewToggle />}
            <ProfileButton />
          </div>
        </header>

        <main className="p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
