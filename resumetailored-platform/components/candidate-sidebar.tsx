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
  FileSearch,
  User,
  Settings,
  Star,
  Crown,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTools, type ToolId } from "@/app/candidate/components/tools-context";

interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Navigation target. Omit when the item opens a tool modal instead. */
  href?: string;
  /** Opens a tool modal instead of navigating. "resume" opens the AI Resume Builder. */
  opens?: ToolId;
  /** Hero item — always violet-tinted so it reads as the primary action. */
  hero?: boolean;
  /** Show a small "PRO" pill to the right. */
  pro?: boolean;
  /** Fully Pro-gated: free users see a lock and clicking opens the upgrade flow. */
  locked?: boolean;
}

// Built tools open in a modal (FIX 3); everything else navigates. "Build My
// Resume" is the hero action and opens the AI Resume Builder (FIX 3 / naming).
const navItems: NavItem[] = [
  { label: "Dashboard", href: "/candidate", icon: LayoutDashboard },
  { label: "Build My Resume", opens: "resume", icon: Sparkles, hero: true },
  { label: "My Resumes", href: "/candidate/resumes", icon: FileText },
  { label: "Cover Letters", opens: "cover", icon: PenTool },
  { label: "ATS Scanner", opens: "ats", icon: ScanLine },
  { label: "LinkedIn Optimizer", opens: "linkedin", icon: Contact, pro: true },
  { label: "Interview Coach", opens: "interview", icon: MessageSquare, pro: true },
  { label: "Job Finder", opens: "jobs", icon: Zap, pro: true },
  { label: "Career Hub", opens: "career", icon: Briefcase, pro: true },
  { label: "Decoder", opens: "decoder", icon: FileSearch, pro: true },
  { label: "Application Tracker", href: "/candidate/applications", icon: Send },
  { label: "Shareable Links", href: "/candidate/shareable-links", icon: LinkIcon },
  { label: "Resume Video", opens: "video", icon: Video, pro: true, locked: true },
  { label: "Personal Website", href: "/candidate/studio", icon: Globe, pro: true, locked: true },
  { label: "Templates", href: "/candidate/templates", icon: Layout },
  { label: "Profile", href: "/candidate/profile", icon: User },
  { label: "Settings", href: "/candidate/settings", icon: Settings },
];

function ProBadge() {
  return (
    <span className="ml-auto rounded-full bg-violet px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
      PRO
    </span>
  );
}

interface RoleBadge {
  plan?: "free" | "pro" | "employer" | "employee";
  employerName?: string;
}

export function CandidateSidebar({ role = { plan: "free" } }: { role?: RoleBadge }) {
  const pathname = usePathname();
  const { openResume, openTool } = useTools();
  const plan = role.plan ?? "free";
  const proish = plan === "pro" || plan === "employee";

  const activate = (item: NavItem) => {
    if (item.opens === "resume") openResume();
    else if (item.opens) openTool(item.opens);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center border-b border-border-gold px-6">
        <span className="font-serif text-lg font-medium text-cream">ResumeTailored</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-6">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.href
            ? item.href === "/candidate"
              ? pathname === "/candidate"
              : pathname.startsWith(item.href)
            : false;

          if (item.hero) {
            // Hero action: persistent violet tint + border + trailing star so it
            // stands out as the product's main feature. Opens the builder modal.
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => activate(item)}
                className="flex w-full items-center gap-3 rounded-xl border border-violet bg-violet/15 px-4 py-3 text-sm font-semibold text-white shadow-[0_0_22px_rgba(139,92,246,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet/25"
              >
                <Icon className="h-[18px] w-[18px] shrink-0 text-violet" />
                <span className="flex-1 text-left">{item.label}</span>
                <Star className="h-3.5 w-3.5 shrink-0 fill-gold text-gold" />
              </button>
            );
          }

          const className = cn(
            "flex w-full items-center gap-3 rounded-md px-4 py-3 text-sm transition-all duration-200 text-left",
            isActive
              ? "border-l-2 border-teal bg-violet/10 font-medium text-teal shadow-[0_0_22px_rgba(139,92,246,0.28)]"
              : "border-l-2 border-transparent text-muted-cream hover:bg-white/5"
          );
          const inner = (
            <>
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span className={cn(!item.pro && "flex-1")}>{item.label}</span>
              {item.pro &&
                (item.locked && !proish ? (
                  <Lock className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-cream" />
                ) : (
                  <ProBadge />
                ))}
            </>
          );

          return item.href ? (
            <Link key={item.label} href={item.href} className={className}>
              {inner}
            </Link>
          ) : (
            <button key={item.label} type="button" onClick={() => activate(item)} className={className}>
              {inner}
            </button>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-2 border-t border-border-gold px-6 py-4">
        <Crown className={cn("h-4 w-4", proish ? "text-gold" : "text-muted-cream")} />
        {plan === "pro" ? (
          <span className="text-xs font-medium text-gold">Pro · active</span>
        ) : plan === "employee" ? (
          <span className="text-xs font-medium text-gold">Pro · via {role.employerName || "your team"}</span>
        ) : (
          <a
            href="/candidate?upgrade=pro"
            className="text-xs font-medium text-muted-cream transition-colors hover:text-gold"
          >
            Free plan · Upgrade to Pro
          </a>
        )}
      </div>
    </div>
  );
}
