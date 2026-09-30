"use client";

import Link from "next/link";
import { FileText, ScanLine, PenTool, Sparkles, ArrowRight, type LucideIcon } from "lucide-react";
import { useTools, type ToolId } from "./tools-context";
import type { GenerationStats } from "@/lib/generations";

const QUICK: { id: ToolId; label: string; icon: LucideIcon; desc: string }[] = [
  { id: "resume", label: "Build My Resume", icon: Sparkles, desc: "Rewrite your resume for any job" },
  { id: "ats", label: "ATS Scan", icon: ScanLine, desc: "Score your match & find gaps" },
  { id: "cover", label: "Cover Letter", icon: PenTool, desc: "Generate a matching letter" },
];

/**
 * Dashboard landing shown when no tool is open. Quick-stat cards + quick
 * actions that open the relevant tool in a modal. The time-based greeting and
 * the standalone "Start" button were removed (FIX 1/5) — the sidebar and these
 * quick actions are the entry points now.
 */
export function DashboardHome({ stats }: { stats: GenerationStats }) {
  const { openTool, openResume, isPro } = useTools();

  // Each stat card is tappable to its section, mirroring the employer
  // dashboard's cards. Two navigate (real routes); two open the matching
  // tool modal (there's no standalone route for ATS/Cover, they're modals).
  const statCards: { label: string; value: string; icon: LucideIcon; href?: string; onClick?: () => void }[] = [
    { label: "Resumes built", value: String(stats.resumes), icon: FileText, href: "/candidate/resumes" },
    { label: "ATS scans today", value: String(stats.atsToday), icon: ScanLine, onClick: () => openTool("ats") },
    { label: "Cover letters", value: String(stats.coverLetters), icon: PenTool, onClick: () => openTool("cover") },
    { label: "Templates unlocked", value: isPro ? "104" : "6", icon: Sparkles, href: "/candidate/templates" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-12">
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((s) => {
          const Icon = s.icon;
          const cardClass = "glass glass-hover flex flex-col p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/50 active:scale-[0.99]";
          const inner = (
            <>
              <Icon className="mb-3 h-5 w-5 text-violet" />
              <div className="text-2xl font-bold text-white">{s.value}</div>
              <div className="mt-1 text-sm text-white/60">{s.label}</div>
            </>
          );
          return s.href ? (
            <Link key={s.label} href={s.href} className={cardClass}>
              {inner}
            </Link>
          ) : (
            <button key={s.label} type="button" onClick={s.onClick} className={cardClass}>
              {inner}
            </button>
          );
        })}
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-xl font-medium text-white">Quick actions</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {QUICK.map((q) => {
            const Icon = q.icon;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => (q.id === "resume" ? openResume() : openTool(q.id))}
                className="glass glass-hover group flex flex-col items-start p-5 text-left"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-violet/15">
                  <Icon className="h-5 w-5 text-violet" />
                </div>
                <div className="flex w-full items-center justify-between">
                  <span className="font-medium text-white">{q.label}</span>
                  <ArrowRight className="h-4 w-4 text-white/40 transition-transform group-hover:translate-x-0.5 group-hover:text-violet" />
                </div>
                <span className="mt-1 text-sm text-white/55">{q.desc}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
