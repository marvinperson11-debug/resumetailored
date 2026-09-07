"use client";

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOOLS, useTools } from "./tools-context";

/**
 * Floating tool dock — a persistent glass bar pinned to the bottom-center of
 * the viewport. Each tool is an icon + label; the active tool is highlighted,
 * Pro tools carry a lock. Horizontally scrollable on narrow screens.
 */
export function ToolDock() {
  const { activeTool, isPro, openTool } = useTools();

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="glass pointer-events-auto flex max-w-full items-stretch gap-1 overflow-x-auto rounded-2xl p-1.5 shadow-2xl backdrop-blur-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const active = activeTool === tool.id;
          const locked = tool.kind === "pro" && !isPro;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => openTool(tool.id)}
              aria-label={tool.label}
              aria-pressed={active}
              className={cn(
                "group relative flex min-w-[62px] shrink-0 flex-col items-center gap-1 rounded-xl px-2.5 py-2 text-[11px] font-medium transition-all duration-200",
                active
                  ? "bg-violet/25 text-white shadow-[0_0_18px_rgba(139,92,246,0.4)]"
                  : "text-muted-cream hover:bg-white/8 hover:text-white"
              )}
            >
              <span className="relative">
                <Icon className={cn("h-5 w-5", active && "text-violet")} />
                {locked && (
                  <span className="absolute -right-2 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gold text-navy">
                    <Lock className="h-2 w-2" strokeWidth={3} />
                  </span>
                )}
                {tool.kind === "soon" && (
                  <span className="absolute -right-1.5 -top-1 h-1.5 w-1.5 rounded-full bg-teal" aria-hidden="true" />
                )}
              </span>
              <span className="whitespace-nowrap leading-none">{tool.label}</span>
              {tool.kind === "pro" && (
                <span className="pointer-events-none absolute -top-1 right-1 hidden rounded-full bg-gold px-1 py-0.5 text-[8px] font-bold leading-none text-navy sm:block">
                  PRO
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
