"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ProfileButton } from "./profile-button";
import { LanguageSwitcher } from "./language-switcher";

interface DashboardShellProps {
  sidebar: ReactNode;
  /** Label shown in the top bar (company name or the career-office label). */
  title: string;
  /** The notification bell — passed only by the employer and employee
   *  layouts; the candidate shell omits it, so nothing renders there. */
  bell?: ReactNode;
  children: ReactNode;
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

export function DashboardShell({ sidebar, title, bell, children }: DashboardShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const t = useTranslations("topbar");
  const touchStartX = useRef<number | null>(null);

  // Close the mobile drawer whenever navigation happens.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

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
          <div
            className="absolute inset-y-0 left-0 w-[260px] max-w-[85vw] border-r border-border-gold bg-navy"
            onTouchStart={(e) => {
              touchStartX.current = e.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(e) => {
              const start = touchStartX.current;
              const end = e.changedTouches[0]?.clientX ?? null;
              // A left swipe (moved left by more than 50px) closes the drawer.
              if (start !== null && end !== null && end - start < -50) setDrawerOpen(false);
              touchStartX.current = null;
            }}
          >
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

          <div className="flex items-center gap-2">
            {bell}
            <ProfileButton />
          </div>
        </header>

        <main className="p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
