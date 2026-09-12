"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Undo2, Redo2, Monitor, Tablet, Smartphone, Globe, ArrowLeft, Plus, PanelLeftClose,
  PanelLeftOpen, PanelRightClose, PanelRightOpen, Loader2, Check, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type StudioSite, type StudioSection, type StudioElement, type SectionType, type ElementType,
  templateSite, makeSection, makeElement, newId, isStudioSite,
} from "@/lib/studio-types";
import { renderStudioSite } from "@/lib/studio-render";
import { StudioCanvas } from "./studio-canvas";
import { SectionNavigator, PropertiesPanel, AddMenu, PublishPanel } from "./studio-panels";
import { type Selection, type StudioActions, type Device } from "./studio-shared";

const DRAFT_KEY = "rt_studio_draft_v2";
const NEW_KEY = "rt_studio_new";

function clampHistory<T>(arr: T[], max = 60): T[] {
  return arr.length > max ? arr.slice(arr.length - max) : arr;
}
function cloneElementNewId(el: StudioElement): StudioElement {
  return { ...el, id: newId(el.type), styles: { ...el.styles }, props: { ...el.props } };
}
function cloneSectionNewIds(sec: StudioSection): StudioSection {
  return { ...sec, id: newId("sec"), background: { ...sec.background }, padding: { ...sec.padding }, elements: sec.elements.map(cloneElementNewId) };
}

// Pure immutable helpers (module scope so they're stable across renders).
function withSection(s: StudioSite, id: string, fn: (sec: StudioSection) => StudioSection): StudioSite {
  return { ...s, sections: s.sections.map((x) => (x.id === id ? fn(x) : x)) };
}
function withElement(s: StudioSite, secId: string, elId: string, fn: (el: StudioElement) => StudioElement): StudioSite {
  return withSection(s, secId, (sec) => ({ ...sec, elements: sec.elements.map((e) => (e.id === elId ? fn(e) : e)) }));
}

export function StudioEditor() {
  const router = useRouter();

  const [site, setSite] = useState<StudioSite | null>(null);
  const [past, setPast] = useState<StudioSite[]>([]);
  const [future, setFuture] = useState<StudioSite[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: "page" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [videos, setVideos] = useState<{ id: number; title: string; videoUrl: string }[]>([]);

  // Publish state
  const [slug, setSlug] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [alreadyPublished, setAlreadyPublished] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  // ── Load: new-from-gallery → localStorage draft → published site → default ──
  useEffect(() => {
    let initial: StudioSite | null = null;
    try {
      const fromGallery = sessionStorage.getItem(NEW_KEY);
      if (fromGallery) {
        initial = JSON.parse(fromGallery) as StudioSite;
        sessionStorage.removeItem(NEW_KEY);
      }
    } catch { /* ignore */ }
    if (!initial) {
      try {
        const draft = localStorage.getItem(DRAFT_KEY);
        if (draft) { const parsed = JSON.parse(draft); if (isStudioSite(parsed)) initial = parsed; }
      } catch { /* ignore */ }
    }
    if (initial) {
      setSite(initial);
    } else {
      // Fall back to the published site (if it's a v2 studio site), else a default.
      fetch("/api/personal-website/mine", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { site?: { slug?: string; config?: unknown; published?: boolean } | null }) => {
          if (d.site?.config && isStudioSite(d.site.config)) {
            setSite(d.site.config);
            if (d.site.slug) setSlug(d.site.slug);
            if (d.site.published) setAlreadyPublished(true);
          } else {
            setSite(templateSite("portfolio"));
          }
        })
        .catch(() => setSite(templateSite("portfolio")));
    }
    fetch("/api/resume-video/list", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { videos?: { id: number; title: string; videoUrl: string }[] }) => setVideos(d.videos || []))
      .catch(() => {});
    // Whether a published site already exists (button label + slug prefill).
    fetch("/api/personal-website/mine", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { site?: { slug?: string; published?: boolean } | null }) => { if (d.site?.published) { setAlreadyPublished(true); if (d.site.slug) setSlug((s) => s || d.site!.slug || ""); } })
      .catch(() => {});
  }, []);

  // ── History-aware setter (every mutation flows through this) ──
  const commit = useCallback((updater: (s: StudioSite) => StudioSite) => {
    setSite((cur) => {
      if (!cur) return cur;
      const next = updater(cur);
      if (next === cur) return cur;
      setPast((p) => clampHistory([...p, cur]));
      setFuture([]);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1];
      setSite((cur) => { if (cur) setFuture((f) => [cur, ...f]); return prev; });
      return p.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setSite((cur) => { if (cur) setPast((p) => clampHistory([...p, cur])); return next; });
      return f.slice(1);
    });
  }, []);

  // ── Actions ──
  const actions: StudioActions = useMemo(() => ({
    patchSite: (patch) => commit((s) => ({ ...s, ...patch })),
    patchTheme: (patch) => commit((s) => ({ ...s, theme: { ...s.theme, ...patch } })),
    patchSection: (id, patch) => commit((s) => withSection(s, id, (sec) => ({ ...sec, ...patch }))),
    setSectionBg: (id, bg) => commit((s) => withSection(s, id, (sec) => ({ ...sec, background: bg }))),
    patchElement: (secId, elId, patch) => commit((s) => withElement(s, secId, elId, (e) => ({ ...e, ...patch }))),
    patchElementStyle: (secId, elId, style) => commit((s) => withElement(s, secId, elId, (e) => ({ ...e, styles: { ...e.styles, ...style } }))),
    patchElementProps: (secId, elId, props) => commit((s) => withElement(s, secId, elId, (e) => ({ ...e, props: { ...e.props, ...props } }))),
    setElementContent: (secId, elId, content) => commit((s) => withElement(s, secId, elId, (e) => ({ ...e, content }))),
    addSection: (type: SectionType, afterSectionId?: string) => {
      const sec = makeSection(type);
      commit((s) => {
        const anchor = afterSectionId || (selection.kind === "section" ? selection.sectionId : selection.kind === "element" ? selection.sectionId : undefined);
        const idx = anchor ? s.sections.findIndex((x) => x.id === anchor) : -1;
        const sections = [...s.sections];
        sections.splice(idx >= 0 ? idx + 1 : sections.length, 0, sec);
        return { ...s, sections };
      });
      setSelection({ kind: "section", sectionId: sec.id });
      setAddOpen(false);
    },
    addElement: (type: ElementType, secId?: string) => {
      const el = makeElement(type);
      commit((s) => {
        const targetSec = secId || (selection.kind !== "page" ? selection.sectionId : undefined) || s.sections[s.sections.length - 1]?.id;
        if (!targetSec) return s;
        return withSection(s, targetSec, (sec) => {
          const elements = [...sec.elements];
          const at = selection.kind === "element" && selection.sectionId === targetSec
            ? elements.findIndex((e) => e.id === selection.elementId) + 1
            : elements.length;
          elements.splice(at, 0, el);
          return { ...sec, elements };
        });
      });
      const targetSec = secId || (selection.kind !== "page" ? selection.sectionId : undefined);
      if (targetSec) setSelection({ kind: "element", sectionId: targetSec, elementId: el.id });
      setAddOpen(false);
    },
    deleteSection: (id) => { commit((s) => ({ ...s, sections: s.sections.filter((x) => x.id !== id) })); setSelection({ kind: "page" }); },
    duplicateSection: (id) => commit((s) => {
      const idx = s.sections.findIndex((x) => x.id === id);
      if (idx < 0) return s;
      const clone = cloneSectionNewIds(s.sections[idx]);
      const sections = [...s.sections];
      sections.splice(idx + 1, 0, clone);
      return { ...s, sections };
    }),
    moveSection: (id, dir) => commit((s) => {
      const i = s.sections.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.sections.length) return s;
      const sections = [...s.sections];
      [sections[i], sections[j]] = [sections[j], sections[i]];
      return { ...s, sections };
    }),
    reorderSection: (id, toIndex) => commit((s) => {
      const from = s.sections.findIndex((x) => x.id === id);
      if (from < 0) return s;
      const sections = [...s.sections];
      const [moved] = sections.splice(from, 1);
      sections.splice(Math.max(0, Math.min(toIndex, sections.length)), 0, moved);
      return { ...s, sections };
    }),
    toggleSectionVisible: (id) => commit((s) => withSection(s, id, (sec) => ({ ...sec, visible: !sec.visible }))),
    deleteElement: (secId, elId) => { commit((s) => withSection(s, secId, (sec) => ({ ...sec, elements: sec.elements.filter((e) => e.id !== elId) }))); setSelection({ kind: "section", sectionId: secId }); },
    duplicateElement: (secId, elId) => commit((s) => withSection(s, secId, (sec) => {
      const idx = sec.elements.findIndex((e) => e.id === elId);
      if (idx < 0) return sec;
      const elements = [...sec.elements];
      elements.splice(idx + 1, 0, cloneElementNewId(sec.elements[idx]));
      return { ...sec, elements };
    })),
    moveElement: (secId, elId, dir) => commit((s) => withSection(s, secId, (sec) => {
      const i = sec.elements.findIndex((e) => e.id === elId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= sec.elements.length) return sec;
      const elements = [...sec.elements];
      [elements[i], elements[j]] = [elements[j], elements[i]];
      return { ...sec, elements };
    })),
  }), [commit, selection]);

  // ── Autosave (localStorage + server draft), debounced ──
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!site) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async () => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(site)); } catch { /* ignore quota */ }
      try {
        await fetch("/api/personal-website/save", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ site }),
        });
      } catch { /* offline draft still saved locally */ }
      setSaveState("saved");
    }, 900);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [site]);

  // ── Keyboard: undo/redo + escape ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const editable = (e.target as HTMLElement)?.isContentEditable || /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName || "");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (editable) return;
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (e.key === "Escape") {
        setEditingId(null);
        if (!editable) setSelection({ kind: "page" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const beginEdit = useCallback((secId: string, elId: string) => { setSelection({ kind: "element", sectionId: secId, elementId: elId }); setEditingId(elId); }, []);
  const endEdit = useCallback(() => setEditingId(null), []);
  const selectAndEndEdit = useCallback((sel: Selection) => { setEditingId(null); setSelection(sel); }, []);

  async function publish() {
    if (!site) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch("/api/personal-website/publish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studio: site, slug: slug.trim() || undefined }),
      });
      if (res.status === 402) { router.push("/candidate?upgrade=pro"); return; }
      const d = (await res.json().catch(() => ({}))) as { url?: string; slug?: string; error?: string; message?: string };
      if (!res.ok || !d.url) throw new Error(d.message || d.error || "Publish failed.");
      setPublishedUrl(d.url);
      setAlreadyPublished(true);
      if (d.slug) setSlug(d.slug);
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPublishing(false);
    }
  }

  function downloadHtml() {
    if (!site) return;
    const blob = new Blob([renderStudioSite(site)], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(site.title || "site").replace(/[^a-z0-9-_ ]/gi, "_").slice(0, 40) || "site"}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exit() {
    router.push("/candidate/studio");
  }

  if (!site) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0b0f19] text-muted-cream">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your studio…
      </div>
    );
  }

  const deviceBtn = (d: Device, Icon: typeof Monitor, label: string) => (
    <button
      type="button"
      onClick={() => setDevice(d)}
      title={label}
      className={cn("flex h-8 w-9 items-center justify-center rounded-md transition-colors", device === d ? "bg-violet text-white" : "text-white/50 hover:bg-white/10 hover:text-cream")}
    >
      <Icon size={16} />
    </button>
  );

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#0b0f19]">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 bg-[#0f1119] px-3">
        <button type="button" onClick={exit} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-cream hover:bg-white/8 hover:text-cream">
          <ArrowLeft size={16} /> <span className="hidden sm:inline">Exit</span>
        </button>
        <span className="ml-1 hidden font-serif text-sm text-cream md:inline">Web Studio</span>

        <div className="mx-auto flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 p-0.5">
            <button type="button" onClick={undo} disabled={!past.length} title="Undo" className="flex h-8 w-8 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-cream disabled:opacity-30"><Undo2 size={16} /></button>
            <button type="button" onClick={redo} disabled={!future.length} title="Redo" className="flex h-8 w-8 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-cream disabled:opacity-30"><Redo2 size={16} /></button>
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 p-0.5">
            {deviceBtn("desktop", Monitor, "Desktop")}
            {deviceBtn("tablet", Tablet, "Tablet")}
            {deviceBtn("mobile", Smartphone, "Mobile")}
          </div>
        </div>

        <span className="hidden items-center gap-1 text-xs text-white/40 sm:flex">
          {saveState === "saving" ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : saveState === "saved" ? <><Check size={12} className="text-teal" /> Saved</> : null}
        </span>
        <button type="button" onClick={downloadHtml} title="Download HTML" className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 hover:bg-white/8 hover:text-cream"><Download size={16} /></button>
        <button type="button" onClick={() => setPublishOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet to-[#6d28d9] px-4 py-2 text-sm font-semibold text-white shadow-[0_0_18px_rgba(139,92,246,0.4)] hover:-translate-y-0.5 transition-transform">
          <Globe size={15} /> {alreadyPublished ? "Update" : "Publish"}
        </button>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Left navigator */}
        {leftOpen ? (
          <aside className="hidden w-[260px] shrink-0 border-r border-white/10 bg-[#0f1119] md:block">
            <div className="relative h-full">
              <SectionNavigator site={site} selection={selection} onSelect={selectAndEndEdit} actions={actions} />
              <button type="button" onClick={() => setLeftOpen(false)} title="Collapse" className="absolute right-2 top-3 text-white/35 hover:text-cream"><PanelLeftClose size={16} /></button>
            </div>
          </aside>
        ) : (
          <button type="button" onClick={() => setLeftOpen(true)} title="Sections" className="hidden w-9 shrink-0 items-center justify-center border-r border-white/10 bg-[#0f1119] text-white/45 hover:text-cream md:flex"><PanelLeftOpen size={16} /></button>
        )}

        {/* Center canvas */}
        <main className="min-w-0 flex-1 overflow-auto bg-[#171a24]" onClick={() => selectAndEndEdit({ kind: "page" })}>
          <StudioCanvas
            site={site}
            selection={selection}
            device={device}
            editingId={editingId}
            onSelect={selectAndEndEdit}
            onBeginTextEdit={beginEdit}
            onEndTextEdit={endEdit}
            onAddElementInSection={(secId) => { setSelection({ kind: "section", sectionId: secId }); setAddOpen(true); }}
            actions={actions}
          />
        </main>

        {/* Right properties */}
        {rightOpen ? (
          <aside className="hidden w-[320px] shrink-0 border-l border-white/10 bg-[#0f1119] lg:block">
            <div className="relative h-full">
              <button type="button" onClick={() => setRightOpen(false)} title="Collapse" className="absolute right-2 top-3 z-10 text-white/35 hover:text-cream"><PanelRightClose size={16} /></button>
              <PropertiesPanel site={site} selection={selection} actions={actions} videos={videos} />
            </div>
          </aside>
        ) : (
          <button type="button" onClick={() => setRightOpen(true)} title="Properties" className="hidden w-9 shrink-0 items-center justify-center border-l border-white/10 bg-[#0f1119] text-white/45 hover:text-cream lg:flex"><PanelRightOpen size={16} /></button>
        )}
      </div>

      {/* Floating + */}
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="fixed bottom-6 left-1/2 z-[120] flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full bg-violet text-white shadow-[0_8px_30px_rgba(139,92,246,0.5)] transition-transform hover:scale-105"
        title="Add section or element"
      >
        <Plus size={22} />
      </button>

      {addOpen && <AddMenu onAddSection={actions.addSection} onAddElement={(t) => actions.addElement(t)} onClose={() => setAddOpen(false)} />}
      {publishOpen && (
        <PublishPanel
          site={site}
          slug={slug}
          setSlug={setSlug}
          publishing={publishing}
          publishedUrl={publishedUrl}
          alreadyPublished={alreadyPublished}
          error={publishError}
          onPublish={publish}
          onClose={() => setPublishOpen(false)}
          actions={actions}
        />
      )}
    </div>
  );
}
