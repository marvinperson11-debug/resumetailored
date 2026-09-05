"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Briefcase,
  Users,
  Clock,
  DollarSign,
  BarChart3,
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
  { label: "Dashboard", href: "/employer", icon: LayoutDashboard },
  { label: "Hire", href: "/employer/hire", icon: Briefcase },
  { label: "People", href: "/employer/people", icon: Users },
  { label: "Time", href: "/employer/time", icon: Clock },
  { label: "Payroll", href: "/employer/payroll", icon: DollarSign },
  { label: "Reports", href: "/employer/reports", icon: BarChart3 },
  { label: "Settings", href: "/employer/settings", icon: Settings },
];

export function EmployerSidebar() {
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
            item.href === "/employer"
              ? pathname === "/employer"
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
        <span className="text-xs font-medium text-gold">Portal · $49/mo</span>
      </div>
    </div>
  );
}
