"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Sparkles,
  FileText,
  PenTool,
  ScanLine,
  Contact,
  Zap,
  Send,
  Link as LinkIcon,
  Video,
  Globe,
  Briefcase,
  Layout,
  MessageSquare,
  User,
  Settings,
  Star,
  Crown,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Hero item — always gold-tinted so it reads as the primary action. */
  hero?: boolean;
  /** Show a small gold "PRO" pill to the right. */
  pro?: boolean;
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard/candidate", icon: LayoutDashboard },
  { label: "Tailor My Resume", href: "/dashboard/candidate/tailor", icon: Sparkles, hero: true },
  { label: "My Resumes", href: "/dashboard/candidate/resumes", icon: FileText },
  { label: "Cover Letters", href: "/dashboard/candidate/cover-letters", icon: PenTool },
  { label: "ATS Scanner", href: "/dashboard/candidate/ats-scanner", icon: ScanLine },
  { label: "LinkedIn Optimizer", href: "/dashboard/candidate/linkedin-optimizer", icon: Contact },
  { label: "Job Matches", href: "/dashboard/candidate/matches", icon: Zap },
  { label: "Applications", href: "/dashboard/candidate/applications", icon: Send },
  { label: "Shareable Links", href: "/dashboard/candidate/shareable-links", icon: LinkIcon },
  { label: "Resume Video", href: "/dashboard/candidate/resume-video", icon: Video, pro: true },
  { label: "Personal Website", href: "/dashboard/candidate/personal-website", icon: Globe, pro: true },
  { label: "Career Hub", href: "/dashboard/candidate/career-hub", icon: Briefcase, pro: true },
  { label: "Templates", href: "/dashboard/candidate/templates", icon: Layout },
  { label: "Interview Prep", href: "/dashboard/candidate/interview-prep", icon: MessageSquare },
  { label: "Profile", href: "/dashboard/candidate/profile", icon: User },
  { label: "Settings", href: "/dashboard/candidate/settings", icon: Settings },
];

function ProBadge() {
  return (
    <span className="ml-auto rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-bold leading-none text-navy">
      PRO
    </span>
  );
}

export function CandidateSidebar() {
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
            item.href === "/dashboard/candidate"
              ? pathname === "/dashboard/candidate"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          if (item.hero) {
            // Hero action: persistent gold tint + border + trailing star so it
            // stands out as the product's main feature, active or not.
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md border border-gold px-4 py-3 text-sm font-semibold text-gold transition-all duration-200 hover:scale-[1.01] hover:bg-gold/15",
                  isActive ? "bg-gold/20" : "bg-gold/10"
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                <span className="flex-1">{item.label}</span>
                <Star className="h-3.5 w-3.5 shrink-0 fill-gold text-gold" />
              </Link>
            );
          }

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
              <span className={cn(!item.pro && "flex-1")}>{item.label}</span>
              {item.pro && <ProBadge />}
            </Link>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-2 border-t border-border-gold px-6 py-4">
        <Crown className="h-4 w-4 text-gold" />
        <span className="text-xs font-medium text-gold">Portal · $19/mo</span>
      </div>
    </div>
  );
}
