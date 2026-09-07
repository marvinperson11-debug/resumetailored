"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { OUT_TPLS, freeFirst, isAtsSafe, type Template } from "@/lib/resume-templates";
import { makeStaticPreview } from "@/lib/template-preview";

/**
 * Template gallery for the Resume + Cover Letter tools. Shows every template
 * (56 resume / 48 cover) as a thumbnail card, free set first. Free templates
 * are selectable by anyone; Pro templates carry a lock and route free users to
 * the upgrade flow when tapped.
 */
export function TemplatePicker({
  cat,
  selectedId,
  onSelect,
  isPro,
}: {
  cat: "resume" | "cover";
  selectedId: string;
  onSelect: (id: string) => void;
  isPro: boolean;
}) {
  const router = useRouter();
  const list = useMemo(() => freeFirst(OUT_TPLS[cat]), [cat]);

  const handleClick = (tpl: Template) => {
    if (!tpl.free && !isPro) {
      router.push("/candidate?upgrade=pro");
      return;
    }
    onSelect(tpl.id);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-white/50">
          {list.length} templates · {list.filter((t) => t.free).length} free
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {list.map((tpl) => {
          const active = tpl.id === selectedId;
          const locked = !tpl.free && !isPro;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => handleClick(tpl)}
              className={cn(
                "group relative overflow-hidden rounded-xl border-2 bg-white text-left transition-all duration-200",
                active ? "border-violet shadow-[0_0_18px_rgba(139,92,246,0.5)]" : "border-transparent hover:border-white/30"
              )}
            >
              <div className="pointer-events-none" dangerouslySetInnerHTML={{ __html: makeStaticPreview(tpl) }} />
              {locked && (
                <div className="absolute inset-0 flex items-center justify-center bg-navy/45 backdrop-blur-[1px] transition-opacity group-hover:bg-navy/30">
                  <span className="flex items-center gap-1 rounded-full bg-gold px-2 py-1 text-[10px] font-bold text-navy">
                    <Lock className="h-3 w-3" /> PRO
                  </span>
                </div>
              )}
              {active && (
                <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-violet text-white">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </div>
              )}
              <div className="flex items-center justify-between gap-1 bg-navy px-2 py-1.5">
                <span className="truncate text-[11px] font-medium text-cream">{tpl.name}</span>
                {cat === "resume" && isAtsSafe(tpl) && (
                  <span className="shrink-0 rounded bg-teal/20 px-1 py-0.5 text-[8px] font-bold uppercase text-teal">ATS</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
