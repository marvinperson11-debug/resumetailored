"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Sparkles, Loader2, PencilRuler } from "lucide-react";
import { cn } from "@/lib/utils";
import { STUDIO_TEMPLATES, GALLERY_FILTERS, templateSite, parseResumeText, type ResumePrefill } from "@/lib/studio-types";
import { renderStudioSite } from "@/lib/studio-render";

interface ResumeRow { id: string; title: string; content: { result?: string; resumeText?: string } }

export function StudioGallery({ hasPublished }: { hasPublished: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState("All");
  const [usePrefill, setUsePrefill] = useState(false);
  const [prefill, setPrefill] = useState<ResumePrefill | null>(null);
  const [resumesLoaded, setResumesLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Load the most recent résumé for the optional pre-fill.
  useEffect(() => {
    fetch("/api/resumes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { drafts?: ResumeRow[] }) => {
        const first = (d.drafts || [])[0];
        if (first) setPrefill(parseResumeText(first.content?.result || first.content?.resumeText || ""));
      })
      .catch(() => {})
      .finally(() => setResumesLoaded(true));
  }, []);

  // One live-rendered sample per template (top-of-page preview).
  const previews = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of STUDIO_TEMPLATES) map[t.id] = renderStudioSite(templateSite(t.id));
    return map;
  }, []);

  const shown = STUDIO_TEMPLATES.filter((t) => filter === "All" || t.categories.includes(filter));

  function choose(id: string) {
    setBusy(id);
    const site = templateSite(id, usePrefill && prefill ? prefill : undefined);
    try { sessionStorage.setItem("rt_studio_new", JSON.stringify(site)); } catch { /* ignore */ }
    // A fresh site replaces any local draft so the editor opens on this template.
    try { localStorage.removeItem("rt_studio_draft_v2"); } catch { /* ignore */ }
    router.push("/candidate/studio/edit");
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#0b0f19]">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-8">
        <button type="button" onClick={() => router.push("/candidate")} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-cream hover:bg-white/8 hover:text-cream">
          <ArrowLeft size={16} /> Dashboard
        </button>
        <div className="flex items-center gap-2">
          <PencilRuler size={18} className="text-violet" />
          <h1 className="font-serif text-lg text-cream">Personal Website</h1>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {hasPublished && (
            <button type="button" onClick={() => router.push("/candidate/studio/edit")} className="rounded-lg border border-white/12 px-3 py-1.5 text-sm text-cream hover:bg-white/8">
              Edit my site
            </button>
          )}
          <button
            type="button"
            onClick={() => setUsePrefill((v) => !v)}
            disabled={!resumesLoaded || !prefill}
            title={!prefill ? "No saved résumé found" : ""}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-40",
              usePrefill ? "border-violet bg-violet/15 text-cream" : "border-white/15 text-muted-cream hover:bg-white/5"
            )}
          >
            <span className={cn("flex h-4 w-4 items-center justify-center rounded border", usePrefill ? "border-violet bg-violet" : "border-white/30")}>
              {usePrefill && <Check size={12} className="text-white" />}
            </span>
            <Sparkles size={14} className="text-violet" /> Use my résumé to pre-fill
          </button>
        </div>
      </header>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 border-b border-white/10 px-4 py-3 sm:px-8">
        {GALLERY_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn("rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors", filter === f ? "bg-violet text-white" : "text-muted-cream hover:bg-white/8")}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Gallery grid */}
      <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-8">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-7 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => choose(t.id)}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#12141d] text-left shadow-lg transition-all duration-200 hover:-translate-y-1 hover:border-violet/60 hover:shadow-[0_18px_50px_rgba(139,92,246,0.35)]"
            >
              <div className="relative">
                <PreviewFrame html={previews[t.id]} />
                <div className="pointer-events-none absolute inset-0 ring-0 transition-all group-hover:ring-2 group-hover:ring-violet/40" />
                {busy === t.id && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-cream">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Opening editor…
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-gradient-to-t from-black/70 to-transparent pb-3 pt-10 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="rounded-full bg-violet px-4 py-2 text-sm font-semibold text-white shadow-lg">Use this template →</span>
                </div>
              </div>
              <div className="flex items-center justify-between px-4 py-3.5">
                <div>
                  <div className="text-sm font-semibold text-cream">{t.label}</div>
                  <div className="text-xs text-white/45">{t.desc}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A scaled, non-interactive live render of a template (top of the page). */
function PreviewFrame({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.34);
  const VIEW_H = 440;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.max(0.1, el.clientWidth / 1200)));
    ro.observe(el);
    setScale(Math.max(0.1, el.clientWidth / 1200));
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", width: "100%", height: VIEW_H, overflow: "hidden", background: "#fff" }}>
      <iframe
        srcDoc={html}
        title="template preview"
        scrolling="no"
        tabIndex={-1}
        style={{
          width: 1200,
          height: Math.round(VIEW_H / scale),
          border: 0,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
