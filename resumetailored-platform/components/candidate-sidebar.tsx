"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Sparkles,
  Send,
  User,
  Settings,
  Crown,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/candidate", icon: LayoutDashboard },
  { label: "My Resumes", href: "/candidate/resumes", icon: FileText },
  { label: "Job Matches", href: "/candidate/matches", icon: Sparkles },
  { label: "Applications", href: "/candidate/applications", icon: Send },
  { label: "Profile", href: "/candidate/profile", icon: User },
  { label: "Settings", href: "/candidate/settings", icon: Settings },
];

export function CandidateSidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b border-border-gold px-6">
        <span className="font-serif text-lg font-medium text-cream">
          ResumeTailored
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-6">
        {navItems.map((item) => {
          const isActive =
            item.href === "/candidate"
              ? pathname === "/candidate"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-4 py-3 text-sm transition-all duration-200",
                isActive
                  ? "border-l-2 border-gold bg-gold/5 font-medium text-gold"
                  : "border-l-2 border-transparent text-muted-cream hover:bg-cream/5"
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2 border-t border-border-gold px-6 py-4">
        <Crown className="h-4 w-4 text-gold" />
        <span className="text-xs font-medium text-gold">Portal · $19/mo</span>
      </div>
    </div>
  );
}
