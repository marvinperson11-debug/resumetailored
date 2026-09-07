"use client";

import { useUser } from "@clerk/nextjs";
import { FileText, ScanLine, PenTool, Sparkles, ArrowRight, type LucideIcon } from "lucide-react";
import { useTools, type ToolId } from "./tools-context";
import type { GenerationStats } from "@/lib/generations";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const QUICK: { id: ToolId; label: string; icon: LucideIcon; desc: string }[] = [
  { id: "resume", label: "Tailor Resume", icon: Sparkles, desc: "Rewrite your resume for any job" },
  { id: "ats", label: "ATS Scan", icon: ScanLine, desc: "Score your match & find gaps" },
  { id: "cover", label: "Cover Letter", icon: PenTool, desc: "Generate a matching letter" },
];

/**
 * Dashboard landing shown when no tool is open. Time-based greeting, quick
 * stats, a primary "Start with Resume Tailor" CTA, and quick actions — all of
 * which open the relevant tool in a modal.
 */
export function DashboardHome({ stats }: { stats: GenerationStats }) {
  const { user } = useUser();
  const { openTool, isPro } = useTools();
  const firstName = user?.firstName || (user?.fullName || "").split(" ")[0] || "there";

  const statCards = [
    { label: "Resumes tailored", value: String(stats.resumes), icon: FileText },
    { label: "ATS scans today", value: String(stats.atsToday), icon: ScanLine },
    { label: "Cover letters", value: String(stats.coverLetters), icon: PenTool },
    { label: "Templates unlocked", value: isPro ? "104" : "6", icon: Sparkles },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-28">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-medium text-white sm:text-4xl">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-2 text-sm text-white/60">Your private career office. Pick a tool below to get started.</p>
        </div>
        <button
          type="button"
          onClick={() => openTool("resume")}
          className="inline-flex items-center gap-2 self-start rounded-xl bg-violet px-6 py-3 text-sm font-semibold text-white shadow-[0_0_22px_rgba(139,92,246,0.4)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_30px_rgba(139,92,246,0.55)] sm:self-auto"
        >
          <Sparkles className="h-4 w-4" /> Start with Resume Tailor
        </button>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="glass p-5">
              <Icon className="mb-3 h-5 w-5 text-violet" />
              <div className="text-2xl font-bold text-white">{s.value}</div>
              <div className="mt-1 text-sm text-white/60">{s.label}</div>
            </div>
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
                onClick={() => openTool(q.id)}
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
