"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Briefcase,
  Users,
  Search,
  Star,
  Mail,
  Calendar,
  Clock,
  DollarSign,
  BarChart3,
  Globe,
  FolderOpen,
  ShieldCheck,
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
  { label: "Dashboard", href: "/dashboard/employer", icon: LayoutDashboard },
  { label: "Hire", href: "/dashboard/employer/hire", icon: Briefcase },
  { label: "People", href: "/dashboard/employer/people", icon: Users },
  { label: "Candidate Search", href: "/dashboard/employer/candidates", icon: Search },
  { label: "Shortlists", href: "/dashboard/employer/shortlists", icon: Star },
  { label: "Messages", href: "/dashboard/employer/messages", icon: Mail },
  { label: "Interview Scheduler", href: "/dashboard/employer/scheduler", icon: Calendar },
  { label: "Time", href: "/dashboard/employer/time", icon: Clock },
  { label: "Payroll", href: "/dashboard/employer/payroll", icon: DollarSign },
  { label: "Reports", href: "/dashboard/employer/reports", icon: BarChart3 },
  { label: "Career Site Builder", href: "/dashboard/employer/career-site", icon: Globe },
  { label: "Documents", href: "/dashboard/employer/documents", icon: FolderOpen },
  { label: "Compliance", href: "/dashboard/employer/compliance", icon: ShieldCheck },
  { label: "Settings", href: "/dashboard/employer/settings", icon: Settings },
];

export function EmployerSidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center border-b border-border-gold px-6">
        <span className="font-serif text-lg font-medium text-cream">
          ResumeTailored
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-6">
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard/employer"
              ? pathname === "/dashboard/employer"
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

      <div className="flex shrink-0 items-center gap-2 border-t border-border-gold px-6 py-4">
        <Crown className="h-4 w-4 text-gold" />
        <span className="text-xs font-medium text-gold">Portal · $49/mo</span>
      </div>
    </div>
  );
}
