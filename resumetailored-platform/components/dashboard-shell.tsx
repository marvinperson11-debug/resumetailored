"use client";

import { useState, type ReactNode } from "react";
import { Menu, X, ChevronDown } from "lucide-react";
import { UserButton } from "@clerk/nextjs";

interface DashboardShellProps {
  sidebar: ReactNode;
  /** Label shown centered in the top bar (company name or "My Career Office"). */
  title: string;
  children: ReactNode;
}

export function DashboardShell({ sidebar, title, children }: DashboardShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen bg-navy">
      {/* Fixed sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[260px] border-r border-border-gold bg-teal lg:block">
        {sidebar}
      </aside>

      {/* Mobile slide-out drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-navy/70"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-[260px] border-r border-border-gold bg-teal">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-4 z-10 text-muted-cream transition-colors hover:text-cream"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      {/* Main column, offset by the sidebar width on desktop */}
      <div className="lg:pl-[260px]">
        {/* Top bar */}
        <header className="flex h-16 items-center justify-between border-b border-border-gold bg-navy px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="text-muted-cream transition-colors hover:text-cream lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <button
            type="button"
            className="flex items-center gap-1.5 text-sm font-medium text-cream transition-colors hover:text-gold"
          >
            <span>{title}</span>
            <ChevronDown className="h-4 w-4 text-muted-cream" />
          </button>

          <div className="flex items-center">
            <UserButton
              afterSignOutUrl="/"
              appearance={{ elements: { avatarBox: "h-8 w-8" } }}
            />
          </div>
        </header>

        {/* Content */}
        <main className="p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
