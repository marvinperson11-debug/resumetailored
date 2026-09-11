"use client";

import { useMemo, useState } from "react";
import { Check, Lock, X, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { OUT_TPLS, freeFirst, isAtsSafe, renderAIOutput, type Template, type TplStyle } from "@/lib/resume-templates";
import { makeStaticPreview } from "@/lib/template-preview";
import { useTools } from "../components/tools-context";

/** style → human filter category. */
const STYLE_CAT: Record<TplStyle, string> = {
  underline: "Professional",
  "left-bar": "Modern",
  "icon-bar": "Creative",
  minimal: "Minimal",
};
const STYLE_FILTERS = ["All", "Professional", "Modern", "Creative", "Minimal"] as const;
const TYPE_FILTERS = ["All", "Resume", "Cover letter"] as const;

const SAMPLE_RESUME = `Alex Morgan
alex.morgan@email.com | San Francisco, CA | (555) 012-3456

SUMMARY
Senior product manager with 8+ years shipping data products used by millions. Led cross-functional teams to grow revenue and retention.

EXPERIENCE
Senior Product Manager
Northwind Analytics | 2021 – Present
• Drove a 34% increase in activation by redesigning onboarding for 200K+ users
• Launched a usage-based pricing tier that added $2.1M ARR in its first year

Product Manager
Brightlane | 2017 – 2021
• Shipped the mobile app to 1M+ downloads with a 4.7-star rating
• Cut churn 18% through a lifecycle-messaging program

EDUCATION
B.S. Computer Science
University of California, Berkeley | 2016

SKILLS
Product strategy, SQL, A/B testing, Roadmapping, Figma, Analytics`;

const SAMPLE_COVER = `Alex Morgan
alex.morgan@email.com | San Francisco, CA

Dear Hiring Manager,

I was excited to see the Senior Product Manager opening at your company — your recent launch is exactly the kind of user-centered work I love to lead.

At Northwind Analytics I redesigned onboarding for 200,000+ users and drove a 34% lift in activation, and I launched a pricing tier that added $2.1M in ARR. I thrive turning ambiguous problems into shipped products that move the numbers.

I'd welcome the chance to bring that same focus to your team.

Sincerely,
Alex Morgan`;

export function TemplatesGallery() {
  const { isPro, openTemplate } = useTools();
  const [type, setType] = useState<(typeof TYPE_FILTERS)[number]>("All");
  const [style, setStyle] = useState<(typeof STYLE_FILTERS)[number]>("All");
  const [preview, setPreview] = useState<{ tpl: Template; cat: "resume" | "cover" } | null>(null);

  const items = useMemo(() => {
    const withCat = [
      ...(type !== "Cover letter" ? freeFirst(OUT_TPLS.resume).map((tpl) => ({ tpl, cat: "resume" as const })) : []),
      ...(type !== "Resume" ? freeFirst(OUT_TPLS.cover).map((tpl) => ({ tpl, cat: "cover" as const })) : []),
    ];
    return style === "All" ? withCat : withCat.filter(({ tpl }) => STYLE_CAT[tpl.style] === style);
  }, [type, style]);

  const total = OUT_TPLS.resume.length + OUT_TPLS.cover.length;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-medium text-cream">Templates</h1>
        <p className="mt-1 text-sm text-white/60">
          {total} designs — {OUT_TPLS.resume.length} resume &amp; {OUT_TPLS.cover.length} cover letter. Preview any of them, then open the builder with it applied.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <FilterGroup value={type} options={TYPE_FILTERS} onChange={setType} />
        <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
        <FilterGroup value={style} options={STYLE_FILTERS} onChange={setStyle} />
        <span className="ml-auto text-xs text-white/40">{items.length} shown</span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-gold p-12 text-center text-sm text-white/50">
          No templates match those filters.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map(({ tpl, cat }) => {
            const locked = !tpl.free && !isPro;
            return (
              <div key={`${cat}-${tpl.id}`} className="group overflow-hidden rounded-2xl border border-border-gold bg-white">
                <button type="button" onClick={() => setPreview({ tpl, cat })} className="relative block w-full text-left" aria-label={`Preview ${tpl.name}`}>
                  <div className="pointer-events-none" dangerouslySetInnerHTML={{ __html: makeStaticPreview(tpl) }} />
                  <div className="absolute inset-0 flex items-center justify-center bg-navy/0 opacity-0 transition-all group-hover:bg-navy/40 group-hover:opacity-100">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-navy">
                      <Eye className="h-3.5 w-3.5" /> Preview
                    </span>
                  </div>
                  {locked && (
                    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold text-navy">
                      <Lock className="h-3 w-3" /> PRO
                    </span>
                  )}
                </button>
                <div className="flex items-center justify-between gap-2 bg-navy px-2.5 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-cream">{tpl.name}</div>
                    <div className="text-[10px] uppercase tracking-wide text-white/40">
                      {cat === "resume" ? "Resume" : "Cover"} · {STYLE_CAT[tpl.style]}
                    </div>
                  </div>
                  {cat === "resume" && isAtsSafe(tpl) && (
                    <span className="shrink-0 rounded bg-teal/20 px-1 py-0.5 text-[8px] font-bold uppercase text-teal">ATS</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {preview && (
        <PreviewModal
          tpl={preview.tpl}
          cat={preview.cat}
          locked={!preview.tpl.free && !isPro}
          onClose={() => setPreview(null)}
          onUse={() => {
            openTemplate(preview.cat, preview.tpl.id);
            setPreview(null);
          }}
        />
      )}
    </div>
  );
}

function FilterGroup<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border-gold p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-colors", value === o ? "bg-violet text-white" : "text-muted-cream hover:bg-white/5")}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function PreviewModal({ tpl, cat, locked, onClose, onUse }: { tpl: Template; cat: "resume" | "cover"; locked: boolean; onClose: () => void; onUse: () => void }) {
  const html = useMemo(
    () => renderAIOutput(cat === "resume" ? SAMPLE_RESUME : SAMPLE_COVER, tpl.id, cat === "resume" ? "resume" : "cover_letter", {}),
    [tpl.id, cat]
  );
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-navy/80 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border-gold bg-navy shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-gold px-5 py-3">
          <div>
            <h2 className="font-serif text-lg font-medium text-cream">{tpl.name}</h2>
            <p className="text-xs text-white/45">{cat === "resume" ? "Resume" : "Cover letter"} · {STYLE_CAT[tpl.style]}{tpl.free ? " · Free" : " · Pro"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-cream hover:bg-white/10 hover:text-cream">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[62vh] overflow-y-auto bg-white/5 p-4">
          <div className="mx-auto max-w-[640px] overflow-hidden rounded-lg bg-white shadow-lg">
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-gold px-5 py-3">
          {locked ? (
            <a href="/candidate?upgrade=pro" className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-gold/90">
              <Lock className="h-4 w-4" /> Unlock with Pro
            </a>
          ) : (
            <button type="button" onClick={onUse} className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet/90">
              <Check className="h-4 w-4" /> Use this template
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
