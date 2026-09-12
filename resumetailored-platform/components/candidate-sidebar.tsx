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
import { useTranslations } from "next-intl";
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
// `label` is an i18n key under the "nav" namespace, resolved at render.
const navItems: NavItem[] = [
  { label: "dashboard", href: "/candidate", icon: LayoutDashboard },
  { label: "buildResume", opens: "resume", icon: Sparkles, hero: true },
  { label: "myResumes", href: "/candidate/resumes", icon: FileText },
  { label: "coverLetters", opens: "cover", icon: PenTool },
  { label: "atsScanner", opens: "ats", icon: ScanLine },
  { label: "linkedin", opens: "linkedin", icon: Contact, pro: true },
  { label: "interview", opens: "interview", icon: MessageSquare, pro: true },
  { label: "jobs", opens: "jobs", icon: Zap, pro: true },
  { label: "career", opens: "career", icon: Briefcase, pro: true },
  { label: "decoder", opens: "decoder", icon: FileSearch, pro: true },
  { label: "applications", href: "/candidate/applications", icon: Send },
  { label: "shareable", href: "/candidate/shareable-links", icon: LinkIcon },
  { label: "resumeVideo", opens: "video", icon: Video, pro: true, locked: true },
  { label: "personalWebsite", href: "/candidate/studio", icon: Globe, pro: true, locked: true },
  { label: "templates", href: "/candidate/templates", icon: Layout },
  { label: "profile", href: "/candidate/profile", icon: User },
  { label: "settings", href: "/candidate/settings", icon: Settings },
];

function ProBadge() {
  const tp = useTranslations("plan");
  return (
    <span className="ml-auto rounded-full bg-violet px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
      {tp("pro")}
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
  const t = useTranslations("nav");
  const tp = useTranslations("plan");
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
                className="flex w-full items-center gap-3 rounded-xl border border-violet bg-violet/15 px-4 py-3 text-sm font-semibold text-white shadow-[0_0_22px_rgba(194,135,11,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet/25"
              >
                <Icon className="h-[18px] w-[18px] shrink-0 text-violet" />
                <span className="flex-1 text-left">{t(item.label)}</span>
                <Star className="h-3.5 w-3.5 shrink-0 fill-gold text-gold" />
              </button>
            );
          }

          const className = cn(
            "flex w-full items-center gap-3 rounded-md px-4 py-3 text-sm transition-all duration-200 text-left",
            isActive
              ? "border-l-2 border-violet bg-violet/10 font-medium text-violet shadow-[0_0_22px_rgba(194,135,11,0.28)]"
              : "border-l-2 border-transparent text-muted-cream hover:bg-white/5"
          );
          const inner = (
            <>
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span className={cn(!item.pro && "flex-1")}>{t(item.label)}</span>
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
          <span className="text-xs font-medium text-gold">{tp("proActive")}</span>
        ) : plan === "employee" ? (
          <span className="text-xs font-medium text-gold">{tp("proVia", { name: role.employerName || "your team" })}</span>
        ) : (
          <a href="/candidate?upgrade=pro" className="text-xs font-medium text-muted-cream transition-colors hover:text-gold">
            {tp("freeUpgrade")}
          </a>
        )}
      </div>
    </div>
  );
}
