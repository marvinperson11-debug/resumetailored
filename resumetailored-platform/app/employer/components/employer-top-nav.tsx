"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProfileButton } from "@/components/profile-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { EmployerSidebar, EMPLOYER_NAV, isEmployerNavActive } from "./employer-sidebar";

/** Corporate top navigation bar: hamburger (mobile/tablet) + logo left, section
 *  links center, company + avatar right. Under lg the links collapse into a
 *  left slide-out drawer (EmployerSidebar). The admin view toggle lives at the
 *  bottom of that drawer, not in this bar. */
export function EmployerTopNav({ company, isAdmin }: { company: string; isAdmin?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);

  // Close the drawer on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-border-gold bg-navy/95 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Left: hamburger (mobile/tablet) + logo */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="text-cream transition-colors hover:text-white lg:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>
          <Link href="/employer" className="flex shrink-0 items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold/15 text-sm font-extrabold tracking-tight text-gold">RT</span>
            <span className="hidden font-serif text-lg font-medium text-cream sm:inline">ResumeTailored</span>
            <span className="hidden rounded bg-gold/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold sm:inline">
              Employer
            </span>
          </Link>
        </div>

        {/* Center: nav links (desktop) */}
        <nav className="hidden items-center gap-1 lg:flex">
          {EMPLOYER_NAV.map((n) => {
            const Icon = n.icon;
            const on = isEmployerNavActive(pathname, n.href, n.exact);
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

        {/* Right: language + company + avatar (admin toggle now lives in the drawer) */}
        <div className="flex items-center gap-3">
          <LanguageSwitcher className="hidden sm:flex" />
          <span className="hidden max-w-[160px] truncate text-sm font-medium text-white/80 md:inline">{company}</span>
          <SignOutButton className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-cream transition-colors hover:bg-white/5 hover:text-cream lg:flex" />
          <ProfileButton />
        </div>
      </div>

      {/* Mobile/tablet slide-out drawer (left) */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy/70" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            className="absolute inset-y-0 left-0 w-[264px] max-w-[85vw] border-r border-border-gold bg-navy shadow-2xl"
            onTouchStart={(e) => {
              touchStartX.current = e.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(e) => {
              const start = touchStartX.current;
              const end = e.changedTouches[0]?.clientX ?? null;
              if (start !== null && end !== null && end - start < -50) setOpen(false);
              touchStartX.current = null;
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-4 z-10 text-muted-cream transition-colors hover:text-cream"
            >
              <X className="h-5 w-5" />
            </button>
            <EmployerSidebar company={company} isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </header>
  );
}
