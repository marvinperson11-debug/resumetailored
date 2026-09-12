"use client";

import { useRef, useState } from "react";
import {
  Eye, EyeOff, GripVertical, Trash2, Copy, ChevronUp, ChevronDown, X, ExternalLink,
  Check, Loader2, Type, Image as ImageIcon, Video, Square, Minus, MoveVertical, Share2, Download,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, Globe, Layers,
  Brush, Star, Quote, Hash, MessageSquareQuote, LayoutGrid, Music, Code2, Mic, Square as StopIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type StudioSite, type StudioSection, type StudioElement, type SectionType, type ElementType,
  type BgType, FONT_CHOICES, SECTION_CHOICES, PATTERNS, ANIM_CHOICES,
} from "@/lib/studio-types";
import { type Selection, type StudioActions, findSection, findElement, imageToDataUrl, fileToDataUrl } from "./studio-shared";

// ── Small reusable dark-panel controls ─────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-white/45">{label}</span>
      {children}
    </label>
  );
}
const inputCn = "w-full rounded-lg border border-white/12 bg-white/5 px-2.5 py-2 text-sm text-cream placeholder:text-white/30 outline-none focus:border-violet";

function TextField({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn(inputCn, mono && "font-mono text-xs")} />;
}
function TextAreaField({ value, onChange, placeholder, rows = 3, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean }) {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} className={cn(inputCn, "resize-y", mono && "font-mono text-xs")} />;
}
function SelectField({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCn, "[&>option]:bg-navy")}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#C2870B";
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="h-8 w-9 shrink-0 cursor-pointer rounded border border-white/12 bg-transparent" />
      <input value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCn, "font-mono text-xs")} />
    </div>
  );
}
function Slider({ value, onChange, min, max, step = 1, suffix }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1.5 flex-1 cursor-pointer accent-violet" />
      <span className="w-12 shrink-0 text-right text-xs text-white/60">{value}{suffix}</span>
    </div>
  );
}
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-1">
      <span className="text-sm text-cream">{label}</span>
      <button type="button" onClick={() => onChange(!checked)} className={cn("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-violet" : "bg-white/15")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </button>
    </label>
  );
}
function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label?: string; icon?: React.ReactNode }[] }) {
  return (
    <div className="flex rounded-lg border border-white/12 bg-white/5 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn("flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors", value === o.value ? "bg-violet text-white" : "text-white/55 hover:text-cream")}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}
function ImagePicker({ onPick, label = "Upload" }: { onPick: (dataUrl: string) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(await imageToDataUrl(f)); }} />
      <button type="button" onClick={() => ref.current?.click()} className="w-full rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs text-white/70 hover:bg-white/5">{label}</button>
    </>
  );
}
/** Upload any media file (video/audio) to a data URL, with a size guard. */
function ImagePickerAny({ onPick, label, accept }: { onPick: (dataUrl: string) => void; label: string; accept: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  return (
    <>
      <input ref={ref} type="file" accept={accept} hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; const d = await fileToDataUrl(f); if (d) { setErr(""); onPick(d); } else setErr("File too large (max 6 MB) — paste a hosted URL instead."); }} />
      <button type="button" onClick={() => ref.current?.click()} className="w-full rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs text-white/70 hover:bg-white/5">{label}</button>
      {err && <p className="mt-1 text-[11px] text-amber-300">{err}</p>}
    </>
  );
}
/** Audio source: URL field + upload + in-browser recording (MediaRecorder). */
function AudioSource({ el, onSet }: { el: StudioElement; onSet: (url: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [err, setErr] = useState("");
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  async function toggleRecord() {
    if (recording) { recRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size > 6_000_000) { setErr("Recording too long (max ~6 MB)."); return; }
        const d = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob); });
        onSet(d);
      };
      mr.start();
      recRef.current = mr;
      setRecording(true);
      mr.addEventListener("stop", () => setRecording(false));
    } catch { setErr("Microphone unavailable — upload a file or paste a URL instead."); }
  }
  return (
    <div className="space-y-2">
      <Field label="Audio URL"><TextField value={el.content} onChange={onSet} placeholder="https://… .mp3" /></Field>
      <ImagePickerAny accept="audio/*" onPick={onSet} label="Upload MP3 / audio file" />
      <button type="button" onClick={toggleRecord} className={cn("flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium", recording ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-white/20 text-white/70 hover:bg-white/5")}>
        {recording ? <><StopIcon size={13} /> Stop recording</> : <><Mic size={13} /> Record voiceover</>}
      </button>
      {el.content && <audio controls src={el.content} className="w-full" style={{ height: 34 }} />}
      {err && <p className="text-[11px] text-amber-300">{err}</p>}
    </div>
  );
}

const px = (v: string | undefined, def: number) => { const n = parseInt(String(v ?? ""), 10); return Number.isFinite(n) ? n : def; };
const num = (v: string | undefined, def: number) => { const n = parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : def; };
const alignOpts = [
  { value: "left" as const, icon: <AlignLeft size={14} /> },
  { value: "center" as const, icon: <AlignCenter size={14} /> },
  { value: "right" as const, icon: <AlignRight size={14} /> },
  { value: "justify" as const, icon: <AlignJustify size={14} /> },
];

// ── Left: Section Navigator (reorder + show/hide) ──────────────────────────────

export function SectionNavigator({ site, selection, onSelect, actions }: { site: StudioSite; selection: Selection; onSelect: (s: Selection) => void; actions: StudioActions }) {
  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <Layers size={15} className="text-violet" />
        <span className="text-sm font-semibold text-cream">Sections</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {site.sections.map((sec, i) => {
          const active = selection.kind === "section" && selection.sectionId === sec.id;
          return (
            <div
              key={sec.id}
              draggable
              onDragStart={() => setDragId(sec.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragId && dragId !== sec.id) actions.reorderSection(dragId, i); setDragId(null); }}
              onClick={() => onSelect({ kind: "section", sectionId: sec.id })}
              className={cn(
                "group mb-1 flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-2 text-sm transition-colors",
                active ? "border-violet bg-violet/15 text-cream" : "border-transparent text-muted-cream hover:bg-white/5",
                !sec.visible && "opacity-50"
              )}
            >
              <GripVertical size={14} className="shrink-0 cursor-grab text-white/30" />
              <span className="flex-1 truncate">{sec.name}</span>
              <button type="button" title={sec.visible ? "Hide" : "Show"} onClick={(e) => { e.stopPropagation(); actions.toggleSectionVisible(sec.id); }} className="shrink-0 text-white/40 hover:text-cream">
                {sec.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Right: context-aware Properties Panel ──────────────────────────────────────

interface PanelProps {
  site: StudioSite;
  selection: Selection;
  actions: StudioActions;
  videos: { id: number; title: string; videoUrl: string }[];
}

export function PropertiesPanel(props: PanelProps) {
  const { site, selection } = props;
  if (selection.kind === "element") {
    const sec = findSection(site, selection.sectionId);
    const el = findElement(site, selection.sectionId, selection.elementId);
    if (sec && el) return <ElementPanel {...props} section={sec} element={el} />;
  }
  if (selection.kind === "section") {
    const sec = findSection(site, selection.sectionId);
    if (sec) return <SectionPanel {...props} section={sec} />;
  }
  return <PagePanel {...props} />;
}

function PanelHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
      {icon}
      <span className="text-sm font-semibold text-cream">{title}</span>
    </div>
  );
}

// ── Page-level panel ──
function PagePanel({ site, actions }: PanelProps) {
  const t = site.theme;
  const fontOpts = FONT_CHOICES.map((f) => ({ value: f.name, label: f.name }));
  return (
    <div className="flex h-full flex-col">
      <PanelHead icon={<Globe size={15} className="text-violet" />} title="Page & Theme" />
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Field label="Page title"><TextField value={site.title} onChange={(v) => actions.patchSite({ title: v })} placeholder="Name | Headline" /></Field>
        <Field label="Meta description"><TextAreaField value={site.metaDescription} onChange={(v) => actions.patchSite({ metaDescription: v })} rows={2} placeholder="Shown in search + link previews" /></Field>
        <Field label="Favicon">
          <div className="flex items-center gap-2">
            {site.faviconUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={site.faviconUrl} alt="" className="h-8 w-8 rounded border border-white/12" />
            )}
            <div className="flex-1"><ImagePicker onPick={(d) => actions.patchSite({ faviconUrl: d })} label={site.faviconUrl ? "Replace favicon" : "Upload favicon"} /></div>
            {site.faviconUrl && <button type="button" onClick={() => actions.patchSite({ faviconUrl: "" })} className="text-white/40 hover:text-red-300"><X size={16} /></button>}
          </div>
        </Field>
        <Field label="Social preview image (URL)"><TextField value={site.ogImageUrl || ""} onChange={(v) => actions.patchSite({ ogImageUrl: v })} placeholder="https://…" /></Field>
        <div className="my-1 border-t border-white/10" />
        <Field label="Heading font"><SelectField value={t.headingFont} onChange={(v) => actions.patchTheme({ headingFont: v })} options={fontOpts} /></Field>
        <Field label="Body font"><SelectField value={t.bodyFont} onChange={(v) => actions.patchTheme({ bodyFont: v })} options={fontOpts} /></Field>
        <Field label="Primary accent"><ColorField value={t.primaryColor} onChange={(v) => actions.patchTheme({ primaryColor: v })} /></Field>
        <Field label="Secondary accent"><ColorField value={t.secondaryColor} onChange={(v) => actions.patchTheme({ secondaryColor: v })} /></Field>
        <Field label="Text color"><ColorField value={t.textColor} onChange={(v) => actions.patchTheme({ textColor: v })} /></Field>
        <Field label="Background color"><ColorField value={t.bgColor} onChange={(v) => actions.patchTheme({ bgColor: v })} /></Field>
        <div className="my-1 border-t border-white/10" />
        <Toggle checked={site.animate !== false} onChange={(v) => actions.patchSite({ animate: v })} label="Fade-in on scroll" />

        {/* Background music (global, loops across the whole site) */}
        <details className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-cream"><Music size={14} className="text-violet" /> Background music</summary>
          <div className="mt-3 space-y-3">
            <Field label="Music URL"><TextField value={site.music?.url || ""} onChange={(v) => actions.patchSite({ music: { url: v, autoplay: site.music?.autoplay ?? false, loop: site.music?.loop ?? true, volume: site.music?.volume ?? 0.6 } })} placeholder="https://… .mp3" /></Field>
            <ImagePickerAny accept="audio/*" label="Upload MP3" onPick={(d) => actions.patchSite({ music: { url: d, autoplay: site.music?.autoplay ?? false, loop: site.music?.loop ?? true, volume: site.music?.volume ?? 0.6 } })} />
            {site.music?.url && (
              <>
                <Toggle checked={site.music.autoplay} onChange={(v) => actions.patchSite({ music: { ...site.music!, autoplay: v } })} label="Auto-play (muted; visitor taps to unmute)" />
                <Toggle checked={site.music.loop !== false} onChange={(v) => actions.patchSite({ music: { ...site.music!, loop: v } })} label="Loop" />
                <Field label={`Volume — ${Math.round((site.music.volume ?? 0.6) * 100)}%`}><Slider value={Math.round((site.music.volume ?? 0.6) * 100)} onChange={(v) => actions.patchSite({ music: { ...site.music!, volume: v / 100 } })} min={0} max={100} suffix="%" /></Field>
                <button type="button" onClick={() => actions.patchSite({ music: undefined })} className="text-xs text-white/50 hover:text-red-300">Remove music</button>
              </>
            )}
          </div>
        </details>

        <Field label="Custom CSS (advanced)"><TextAreaField value={site.customCss || ""} onChange={(v) => actions.patchSite({ customCss: v })} rows={4} mono placeholder=".rt-sec h1{ letter-spacing:-.02em }" /></Field>
        <p className="text-[11px] text-white/35">Tip: click any section or element on the page to edit just that piece.</p>
      </div>
    </div>
  );
}

// ── Section panel ──
function BackgroundEditor({ section, actions }: { section: StudioSection; actions: StudioActions }) {
  const bg = section.background;
  const GRADIENTS = [
    "linear-gradient(135deg,var(--primary),var(--secondary))",
    "linear-gradient(135deg,var(--primary),#0b0b12)",
    "linear-gradient(180deg,#14171f,#0b0d12)",
    "radial-gradient(120% 120% at 50% 0%,color-mix(in srgb,var(--primary) 22%,#fff),#fff)",
    "linear-gradient(120deg,#C2870B,#14B8A6)",
    "linear-gradient(120deg,#F59E0B,#E11D48)",
  ];
  const setType = (type: BgType) => {
    const defaults: Record<BgType, string> = { solid: "var(--bg)", gradient: GRADIENTS[0], pattern: "dots", image: "", video: "" };
    actions.setSectionBg(section.id, { type, value: defaults[type] });
  };
  return (
    <div className="space-y-2">
      <Seg<BgType>
        value={bg.type}
        onChange={setType}
        options={[{ value: "solid", label: "Color" }, { value: "gradient", label: "Grad" }, { value: "pattern", label: "Pattern" }, { value: "image", label: "Image" }, { value: "video", label: "Video" }]}
      />
      {bg.type === "solid" && <ColorField value={bg.value === "var(--bg)" ? "#ffffff" : bg.value} onChange={(v) => actions.setSectionBg(section.id, { type: "solid", value: v })} />}
      {bg.type === "gradient" && (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            {GRADIENTS.map((g) => (
              <button key={g} type="button" onClick={() => actions.setSectionBg(section.id, { type: "gradient", value: g })} className={cn("h-9 rounded-md border", bg.value === g ? "border-violet ring-1 ring-violet" : "border-white/12")} style={{ backgroundImage: g }} />
            ))}
          </div>
          <TextAreaField value={bg.value} onChange={(v) => actions.setSectionBg(section.id, { type: "gradient", value: v })} rows={2} mono placeholder="linear-gradient(...)" />
        </>
      )}
      {bg.type === "pattern" && (
        <Seg value={bg.value} onChange={(v) => actions.setSectionBg(section.id, { type: "pattern", value: v })} options={PATTERNS.map((p) => ({ value: p, label: p }))} />
      )}
      {bg.type === "image" && (
        <div className="space-y-2">
          <TextField value={bg.value} onChange={(v) => actions.setSectionBg(section.id, { type: "image", value: v })} placeholder="https://… image URL" />
          <ImagePicker onPick={(d) => actions.setSectionBg(section.id, { type: "image", value: d })} label="Upload background image" />
        </div>
      )}
      {bg.type === "video" && <TextField value={bg.value} onChange={(v) => actions.setSectionBg(section.id, { type: "video", value: v })} placeholder="https://… .mp4 URL" />}
    </div>
  );
}

function ElementActionsRow({ section, element, actions }: { section: StudioSection; element: StudioElement; actions: StudioActions }) {
  return (
    <div className="flex items-center gap-1.5 border-t border-white/10 pt-3">
      <button type="button" title="Move up" onClick={() => actions.moveElement(section.id, element.id, -1)} className="rounded-md border border-white/12 p-1.5 text-white/60 hover:bg-white/5"><ChevronUp size={15} /></button>
      <button type="button" title="Move down" onClick={() => actions.moveElement(section.id, element.id, 1)} className="rounded-md border border-white/12 p-1.5 text-white/60 hover:bg-white/5"><ChevronDown size={15} /></button>
      <button type="button" title="Duplicate" onClick={() => actions.duplicateElement(section.id, element.id)} className="rounded-md border border-white/12 p-1.5 text-white/60 hover:bg-white/5"><Copy size={15} /></button>
      <button type="button" title="Delete" onClick={() => actions.deleteElement(section.id, element.id)} className="ml-auto rounded-md border border-red-500/30 p-1.5 text-red-300 hover:bg-red-500/10"><Trash2 size={15} /></button>
    </div>
  );
}

function SectionPanel({ section, actions }: PanelProps & { section: StudioSection }) {
  return (
    <div className="flex h-full flex-col">
      <PanelHead icon={<Square size={15} className="text-violet" />} title="Section" />
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Field label="Section name"><TextField value={section.name} onChange={(v) => actions.patchSection(section.id, { name: v })} /></Field>
        <Field label="Background"><BackgroundEditor section={section} actions={actions} /></Field>
        <Field label="Layout">
          <Seg value={section.layout} onChange={(v) => actions.patchSection(section.id, { layout: v })} options={[{ value: "full", label: "Full" }, { value: "contained", label: "Contained" }, { value: "split", label: "Split" }]} />
        </Field>
        <Field label={`Padding top — ${section.padding.top}px`}><Slider value={section.padding.top} onChange={(v) => actions.patchSection(section.id, { padding: { ...section.padding, top: v } })} min={0} max={200} suffix="px" /></Field>
        <Field label={`Padding bottom — ${section.padding.bottom}px`}><Slider value={section.padding.bottom} onChange={(v) => actions.patchSection(section.id, { padding: { ...section.padding, bottom: v } })} min={0} max={200} suffix="px" /></Field>
        <Toggle checked={section.visible} onChange={() => actions.toggleSectionVisible(section.id)} label="Visible" />
        <div className="flex items-center gap-1.5 border-t border-white/10 pt-3">
          <button type="button" onClick={() => actions.moveSection(section.id, -1)} className="rounded-md border border-white/12 p-1.5 text-white/60 hover:bg-white/5"><ChevronUp size={15} /></button>
          <button type="button" onClick={() => actions.moveSection(section.id, 1)} className="rounded-md border border-white/12 p-1.5 text-white/60 hover:bg-white/5"><ChevronDown size={15} /></button>
          <button type="button" onClick={() => actions.duplicateSection(section.id)} className="inline-flex items-center gap-1 rounded-md border border-white/12 px-2 py-1.5 text-xs text-white/70 hover:bg-white/5"><Copy size={14} /> Duplicate</button>
          <button type="button" onClick={() => actions.deleteSection(section.id)} className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1.5 text-xs text-red-300 hover:bg-red-500/10"><Trash2 size={14} /> Delete</button>
        </div>
      </div>
    </div>
  );
}

// ── Shared "paint-brush" style & effects block (any element) ──
function StyleEffects({ el, setStyle, setProps }: { el: StudioElement; setStyle: (s: Record<string, string>) => void; setProps: (p: Record<string, string | number | boolean>) => void }) {
  const borderStyle = String(el.styles.borderStyle || "none");
  const shadowOn = !!el.styles.boxShadow && el.styles.boxShadow !== "none";
  const shadowI = Number(el.props.shadowI ?? 3);
  const applyShadow = (on: boolean, i: number) => {
    if (!on) { setStyle({ boxShadow: "none" }); return; }
    setStyle({ boxShadow: `0 ${Math.round(i * 2)}px ${Math.round(i * 7)}px rgba(0,0,0,${(0.04 + i * 0.03).toFixed(3)})` });
    setProps({ shadowI: i });
  };
  return (
    <details className="rounded-xl border border-white/10 bg-white/[0.03] p-3" id="rt-style-block">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-cream"><Brush size={14} className="text-violet" /> Style &amp; effects</summary>
      <div className="mt-3 space-y-3">
        <Field label="Border"><Seg value={borderStyle} onChange={(v) => setStyle({ borderStyle: v, ...(v !== "none" ? { borderWidth: el.styles.borderWidth || "1px", borderColor: el.styles.borderColor || "#e5e5e5" } : {}) })} options={[{ value: "none", label: "None" }, { value: "solid", label: "Solid" }, { value: "dashed", label: "Dashed" }, { value: "dotted", label: "Dotted" }]} /></Field>
        {borderStyle !== "none" && (
          <>
            <Field label={`Border width — ${px(el.styles.borderWidth, 1)}px`}><Slider value={px(el.styles.borderWidth, 1)} onChange={(v) => setStyle({ borderWidth: `${v}px` })} min={1} max={12} suffix="px" /></Field>
            <Field label="Border color"><ColorField value={String(el.styles.borderColor || "#e5e5e5")} onChange={(v) => setStyle({ borderColor: v })} /></Field>
          </>
        )}
        <Field label={`Corner radius — ${px(el.styles.borderRadius, 0)}px`}><Slider value={px(el.styles.borderRadius, 0)} onChange={(v) => setStyle({ borderRadius: `${v}px` })} min={0} max={60} suffix="px" /></Field>
        <Toggle checked={shadowOn} onChange={(v) => applyShadow(v, shadowI)} label="Box shadow" />
        {shadowOn && <Field label={`Shadow intensity — ${shadowI}`}><Slider value={shadowI} onChange={(v) => applyShadow(true, v)} min={1} max={10} /></Field>}
        <Field label={`Padding — ${px(el.styles.padding, 0)}px`}><Slider value={px(el.styles.padding, 0)} onChange={(v) => setStyle({ padding: `${v}px` })} min={0} max={80} suffix="px" /></Field>
        <Field label={`Margin — ${px(el.styles.margin, 0)}px`}><Slider value={px(el.styles.margin, 0)} onChange={(v) => setStyle({ margin: `${v}px` })} min={0} max={80} suffix="px" /></Field>
        <Field label="Background">
          <div className="flex items-center gap-2">
            <ColorField value={String(el.styles.background || "").startsWith("#") ? String(el.styles.background) : "#ffffff"} onChange={(v) => setStyle({ background: v })} />
            <button type="button" onClick={() => setStyle({ background: "" })} className="shrink-0 rounded-md border border-white/12 px-2 py-1.5 text-xs text-white/60 hover:bg-white/5">Clear</button>
          </div>
        </Field>
        <div className="border-t border-white/10 pt-3" />
        <Field label="Animation on scroll"><SelectField value={String(el.props.anim || "")} onChange={(v) => setProps({ anim: v })} options={[{ value: "", label: "Default (fade)" }, ...ANIM_CHOICES.map((a) => ({ value: a.value, label: a.label }))]} /></Field>
        <Field label={`Delay — ${Number(el.props.animDelay) || 0}ms`}><Slider value={Number(el.props.animDelay) || 0} onChange={(v) => setProps({ animDelay: v })} min={0} max={1500} step={50} suffix="ms" /></Field>
        <Field label={`Duration — ${Number(el.props.animDuration) || 600}ms`}><Slider value={Number(el.props.animDuration) || 600} onChange={(v) => setProps({ animDuration: v })} min={150} max={2000} step={50} suffix="ms" /></Field>
      </div>
    </details>
  );
}

// ── Element panel (per type) ──
function ElementPanel({ section, element: el, actions, videos }: PanelProps & { section: StudioSection; element: StudioElement }) {
  const sid = section.id, eid = el.id;
  const setStyle = (s: Record<string, string>) => actions.patchElementStyle(sid, eid, s);
  const setProps = (p: Record<string, string | number | boolean>) => actions.patchElementProps(sid, eid, p);

  const typeLabel: Record<ElementType, string> = {
    heading: "Heading", text: "Text", image: "Image", video: "Video", button: "Button",
    divider: "Divider", spacer: "Spacer", social: "Social links", "resume-download": "Résumé download",
    icon: "Icon", quote: "Quote", stat: "Stat counter", testimonial: "Testimonial", gallery: "Gallery", audio: "Audio", embed: "Embed",
  };
  const typeIcon: Record<string, React.ReactNode> = {
    heading: <Type size={15} className="text-violet" />, text: <Type size={15} className="text-violet" />,
    image: <ImageIcon size={15} className="text-violet" />, video: <Video size={15} className="text-violet" />,
    button: <Square size={15} className="text-violet" />, divider: <Minus size={15} className="text-violet" />,
    spacer: <MoveVertical size={15} className="text-violet" />, social: <Share2 size={15} className="text-violet" />,
    "resume-download": <Download size={15} className="text-violet" />,
    icon: <Star size={15} className="text-violet" />, quote: <Quote size={15} className="text-violet" />,
    stat: <Hash size={15} className="text-violet" />, testimonial: <MessageSquareQuote size={15} className="text-violet" />,
    gallery: <LayoutGrid size={15} className="text-violet" />, audio: <Music size={15} className="text-violet" />, embed: <Code2 size={15} className="text-violet" />,
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHead icon={typeIcon[el.type]} title={typeLabel[el.type]} />
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {(el.type === "heading" || el.type === "text" || el.type === "quote" || el.type === "icon") && (
          <>
            {el.type === "icon" && <p className="text-[11px] text-white/40">Click the icon on the canvas to type any emoji or glyph.</p>}
            {el.type === "heading" && (
              <Field label="Level"><Seg value={String(el.props.level || 2)} onChange={(v) => setProps({ level: Number(v) })} options={[{ value: "1", label: "H1" }, { value: "2", label: "H2" }, { value: "3", label: "H3" }]} /></Field>
            )}
            {el.type === "quote" && <Field label="Attribution (optional)"><TextField value={String(el.props.cite || "")} onChange={(v) => setProps({ cite: v })} placeholder="Person, Company" /></Field>}
            <Field label="Font"><SelectField value={String(el.styles.fontFamily || "")} onChange={(v) => setStyle({ fontFamily: v })} options={[{ value: "", label: "Theme default" }, ...FONT_CHOICES.map((f) => ({ value: f.stack, label: f.name }))]} /></Field>
            <Field label={`Font size — ${px(el.styles.fontSize, 17)}px`}><Slider value={px(el.styles.fontSize, 17)} onChange={(v) => setStyle({ fontSize: `${v}px` })} min={10} max={140} suffix="px" /></Field>
            <Field label="Font weight"><SelectField value={String(el.styles.fontWeight || "")} onChange={(v) => setStyle({ fontWeight: v })} options={[{ value: "", label: "Default" }, { value: "300", label: "Light" }, { value: "400", label: "Normal" }, { value: "600", label: "Semibold" }, { value: "700", label: "Bold" }, { value: "900", label: "Black" }]} /></Field>
            <Field label="Color"><ColorField value={String(el.styles.color || "").startsWith("#") ? String(el.styles.color) : "#1a1a1a"} onChange={(v) => setStyle({ color: v })} /></Field>
            <Field label="Alignment"><Seg value={String(el.styles.textAlign || "left")} onChange={(v) => setStyle({ textAlign: v })} options={alignOpts} /></Field>
            <Field label={`Line height — ${num(el.styles.lineHeight, el.type === "heading" ? 1.12 : 1.65)}`}><Slider value={num(el.styles.lineHeight, el.type === "heading" ? 1.12 : 1.65)} onChange={(v) => setStyle({ lineHeight: String(v) })} min={0.9} max={2.4} step={0.05} /></Field>
            <Field label={`Letter spacing — ${num(el.styles.letterSpacing, 0)}em`}><Slider value={num(el.styles.letterSpacing, 0)} onChange={(v) => setStyle({ letterSpacing: `${v}em` })} min={-0.05} max={0.4} step={0.01} suffix="em" /></Field>
            <Field label="Transform"><SelectField value={String(el.styles.textTransform || "none")} onChange={(v) => setStyle({ textTransform: v })} options={[{ value: "none", label: "None" }, { value: "uppercase", label: "UPPERCASE" }, { value: "capitalize", label: "Capitalize" }, { value: "lowercase", label: "lowercase" }]} /></Field>
          </>
        )}

        {el.type === "image" && (
          <>
            <Field label="Image"><ImagePicker onPick={(d) => actions.setElementContent(sid, eid, d)} label={el.content ? "Replace image" : "Upload image"} /></Field>
            <Field label="…or image URL"><TextField value={el.content} onChange={(v) => actions.setElementContent(sid, eid, v)} placeholder="https://…" /></Field>
            <Field label="Alt text"><TextField value={String(el.props.alt || "")} onChange={(v) => setProps({ alt: v })} placeholder="Describe the image" /></Field>
            <Field label={`Corner radius — ${px(String(el.props.radius), 14)}px`}><Slider value={px(String(el.props.radius), 14)} onChange={(v) => setProps({ radius: v })} min={0} max={60} suffix="px" /></Field>
            <Toggle checked={el.props.shadow !== false} onChange={(v) => setProps({ shadow: v })} label="Drop shadow" />
            <Field label="Fit"><Seg value={String(el.props.fit || "cover")} onChange={(v) => setProps({ fit: v })} options={[{ value: "cover", label: "Cover" }, { value: "contain", label: "Contain" }, { value: "original", label: "Original" }]} /></Field>
            <Field label="On click"><SelectField value={String(el.props.behavior || "none")} onChange={(v) => setProps({ behavior: v })} options={[{ value: "none", label: "Nothing" }, { value: "link", label: "Open link" }]} /></Field>
            {el.props.behavior === "link" && <Field label="Link URL"><TextField value={String(el.props.url || "")} onChange={(v) => setProps({ url: v })} placeholder="https://…" /></Field>}
          </>
        )}

        {el.type === "video" && (
          <>
            <Field label="Video URL (mp4 · YouTube · Vimeo)"><TextField value={el.content} onChange={(v) => actions.setElementContent(sid, eid, v)} placeholder="https://youtu.be/…" /></Field>
            <Field label="Upload a video file"><ImagePickerAny accept="video/*" onPick={(d) => actions.setElementContent(sid, eid, d)} label="Upload video (kept small — URL recommended)" /></Field>
            {videos.length > 0 && (
              <Field label="…or use my Résumé Video">
                <SelectField value="" onChange={(v) => { if (v) actions.setElementContent(sid, eid, v); }} options={[{ value: "", label: "Choose a saved video…" }, ...videos.map((vv) => ({ value: vv.videoUrl, label: vv.title }))]} />
              </Field>
            )}
            <Toggle checked={el.props.autoplay === true} onChange={(v) => setProps({ autoplay: v })} label="Autoplay" />
            <Toggle checked={el.props.mute !== false} onChange={(v) => setProps({ mute: v })} label="Muted" />
            <Toggle checked={el.props.loop === true} onChange={(v) => setProps({ loop: v })} label="Loop" />
            <Field label="Poster image URL"><TextField value={String(el.props.poster || "")} onChange={(v) => setProps({ poster: v })} placeholder="https://…" /></Field>
            <Field label="Alignment"><Seg value={String(el.styles.textAlign || "left")} onChange={(v) => setStyle({ textAlign: v })} options={alignOpts} /></Field>
          </>
        )}

        {(el.type === "button" || el.type === "resume-download") && (
          <>
            <Field label="Text"><TextField value={el.content} onChange={(v) => actions.setElementContent(sid, eid, v)} /></Field>
            <Field label={el.type === "resume-download" ? "Résumé file URL" : "Link URL"}><TextField value={String(el.props.url || "")} onChange={(v) => setProps({ url: v })} placeholder="https://…" /></Field>
            <Field label="Style"><Seg value={String(el.props.variant || "solid")} onChange={(v) => setProps({ variant: v })} options={[{ value: "solid", label: "Solid" }, { value: "outline", label: "Outline" }, { value: "ghost", label: "Ghost" }]} /></Field>
            <Field label={`Corner radius — ${px(String(el.props.radius), 10)}px`}><Slider value={px(String(el.props.radius), 10)} onChange={(v) => setProps({ radius: v })} min={0} max={40} suffix="px" /></Field>
            <Field label="Alignment"><Seg value={String(el.styles.textAlign || "left")} onChange={(v) => setStyle({ textAlign: v })} options={alignOpts} /></Field>
          </>
        )}

        {el.type === "social" && (
          <>
            {(["linkedin", "github", "twitter", "website"] as const).map((k) => (
              <Field key={k} label={k}><TextField value={String(el.props[k] || "")} onChange={(v) => setProps({ [k]: v })} placeholder="https://…" /></Field>
            ))}
            <Field label="email"><TextField value={String(el.props.email || "")} onChange={(v) => setProps({ email: v })} placeholder="you@example.com" /></Field>
            <Field label="Alignment"><Seg value={String(el.styles.textAlign || "left")} onChange={(v) => setStyle({ textAlign: v })} options={alignOpts} /></Field>
          </>
        )}

        {el.type === "stat" && (
          <>
            <Field label="Value"><TextField value={String(el.props.value || "")} onChange={(v) => setProps({ value: v })} placeholder="200+" /></Field>
            <Field label="Label"><TextField value={String(el.props.label || "")} onChange={(v) => setProps({ label: v })} placeholder="Projects shipped" /></Field>
            <Field label="Alignment"><Seg value={String(el.styles.textAlign || "center")} onChange={(v) => setStyle({ textAlign: v })} options={alignOpts} /></Field>
          </>
        )}

        {el.type === "testimonial" && (
          <>
            <Field label="Quote"><TextAreaField value={String(el.props.quote || "")} onChange={(v) => setProps({ quote: v })} rows={3} /></Field>
            <Field label="Author"><TextField value={String(el.props.author || "")} onChange={(v) => setProps({ author: v })} /></Field>
            <Field label="Role / company"><TextField value={String(el.props.role || "")} onChange={(v) => setProps({ role: v })} /></Field>
            <Field label="Avatar"><ImagePicker onPick={(d) => setProps({ avatar: d })} label={el.props.avatar ? "Replace avatar" : "Upload avatar"} /></Field>
          </>
        )}

        {el.type === "gallery" && (
          <>
            <Field label="Add images"><ImagePicker onPick={(d) => actions.setElementContent(sid, eid, (el.content ? el.content + "\n" : "") + d)} label="Upload image to gallery" /></Field>
            <Field label="Image URLs (one per line)"><TextAreaField value={el.content} onChange={(v) => actions.setElementContent(sid, eid, v)} rows={4} placeholder={"https://…\nhttps://…"} /></Field>
            <Field label={`Columns — ${Number(el.props.columns) || 3}`}><Slider value={Number(el.props.columns) || 3} onChange={(v) => setProps({ columns: v })} min={1} max={6} /></Field>
            <Field label={`Gap — ${Number(el.props.gap ?? 12)}px`}><Slider value={Number(el.props.gap ?? 12)} onChange={(v) => setProps({ gap: v })} min={0} max={40} suffix="px" /></Field>
            <Field label={`Corner radius — ${Number(el.props.radius ?? 12)}px`}><Slider value={Number(el.props.radius ?? 12)} onChange={(v) => setProps({ radius: v })} min={0} max={40} suffix="px" /></Field>
          </>
        )}

        {el.type === "audio" && (
          <>
            <AudioSource el={el} onSet={(url) => actions.setElementContent(sid, eid, url)} />
            <Field label="Label (optional)"><TextField value={String(el.props.label || "")} onChange={(v) => setProps({ label: v })} placeholder="Listen to my intro" /></Field>
            <Toggle checked={el.props.autoplay === true} onChange={(v) => setProps({ autoplay: v })} label="Auto-play (muted) when the site opens" />
            <Toggle checked={el.props.loop === true} onChange={(v) => setProps({ loop: v })} label="Loop" />
          </>
        )}

        {el.type === "embed" && (
          <>
            <Field label="Embed URL (iframe src)"><TextField value={el.content} onChange={(v) => actions.setElementContent(sid, eid, v)} placeholder="https://…" /></Field>
            <Field label={`Height — ${Number(el.props.height) || 360}px`}><Slider value={Number(el.props.height) || 360} onChange={(v) => setProps({ height: v })} min={120} max={900} step={20} suffix="px" /></Field>
            <p className="text-[11px] text-white/40">Any https page: a map, form, calendar, playlist, etc.</p>
          </>
        )}

        {el.type === "divider" && (
          <>
            <Field label="Color"><ColorField value={String(el.styles.background || "").startsWith("#") ? String(el.styles.background) : "#888888"} onChange={(v) => setStyle({ background: v, opacity: "1" })} /></Field>
            <Field label={`Thickness — ${px(el.styles.height, 1)}px`}><Slider value={px(el.styles.height, 1)} onChange={(v) => setStyle({ height: `${v}px` })} min={1} max={12} suffix="px" /></Field>
          </>
        )}

        {el.type === "spacer" && (
          <Field label={`Height — ${Number(el.props.height) || 40}px`}><Slider value={Number(el.props.height) || 40} onChange={(v) => setProps({ height: v })} min={4} max={240} suffix="px" /></Field>
        )}

        {el.type !== "spacer" && <StyleEffects el={el} setStyle={setStyle} setProps={setProps} />}
        <ElementActionsRow section={section} element={el} actions={actions} />
      </div>
    </div>
  );
}

// ── Floating "+" Add menu ──────────────────────────────────────────────────────

export function AddMenu({ onAddSection, onAddElement, onClose }: { onAddSection: (t: SectionType) => void; onAddElement: (t: ElementType) => void; onClose: () => void }) {
  const elements: { type: ElementType; label: string }[] = [
    { type: "heading", label: "Heading" }, { type: "text", label: "Text" }, { type: "image", label: "Image" },
    { type: "video", label: "Video" }, { type: "button", label: "Button" }, { type: "divider", label: "Divider" },
    { type: "spacer", label: "Spacer" }, { type: "social", label: "Social links" }, { type: "resume-download", label: "Résumé download" },
    { type: "icon", label: "Icon" }, { type: "quote", label: "Quote" }, { type: "stat", label: "Stat counter" },
    { type: "testimonial", label: "Testimonial" }, { type: "gallery", label: "Gallery grid" }, { type: "audio", label: "Audio / voiceover" }, { type: "embed", label: "Embed (iframe)" },
  ];
  return (
    <>
      <div className="fixed inset-0 z-[150]" onClick={onClose} />
      <div className="fixed bottom-24 left-1/2 z-[151] max-h-[70vh] w-[min(560px,92vw)] -translate-x-1/2 overflow-y-auto rounded-2xl border border-white/12 bg-[#12141d] p-4 shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-cream">Add a section</h3>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-cream"><X size={16} /></button>
        </div>
        <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {SECTION_CHOICES.map((s) => (
            <button key={s.type} type="button" onClick={() => onAddSection(s.type)} className="rounded-lg border border-white/12 bg-white/5 px-2 py-2.5 text-xs font-medium text-cream hover:border-violet hover:bg-violet/10">{s.label}</button>
          ))}
        </div>
        <h3 className="mb-2 text-sm font-semibold text-cream">Add an element</h3>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {elements.map((e) => (
            <button key={e.type} type="button" onClick={() => onAddElement(e.type)} className="rounded-lg border border-white/12 bg-white/5 px-2 py-2.5 text-xs font-medium text-cream hover:border-violet hover:bg-violet/10">{e.label}</button>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-white/35">Elements are added to the selected section (or the last one).</p>
      </div>
    </>
  );
}

// ── Publish slide-out ──────────────────────────────────────────────────────────

export function PublishPanel({
  site, slug, setSlug, publishing, publishedUrl, alreadyPublished, error, onPublish, onClose, actions,
}: {
  site: StudioSite;
  slug: string;
  setSlug: (v: string) => void;
  publishing: boolean;
  publishedUrl: string | null;
  alreadyPublished: boolean;
  error: string | null;
  onPublish: () => void;
  onClose: () => void;
  actions: StudioActions;
}) {
  const [copied, setCopied] = useState(false);
  const preview = `app.resumetailored.com/site/${slug || "your-name"}`;
  return (
    <>
      <div className="fixed inset-0 z-[160] bg-black/40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-[161] flex w-[min(420px,100vw)] flex-col border-l border-white/12 bg-[#0f1119] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h3 className="font-serif text-lg text-cream">Publish website</h3>
          <button type="button" onClick={onClose} className="text-white/45 hover:text-cream"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <Field label="Your site URL">
            <div className="flex items-center gap-1 rounded-lg border border-white/12 bg-white/5 px-2.5 py-2 text-sm text-white/50">
              <span className="truncate">{preview}</span>
            </div>
          </Field>
          <Field label="Custom address"><TextField value={slug} onChange={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="your-name" /></Field>
          <p className="-mt-2 text-[11px] text-white/35">3–30 characters — letters, numbers, hyphens. A taken name gets a short random suffix.</p>
          <div className="my-1 border-t border-white/10" />
          <Field label="SEO title"><TextField value={site.title} onChange={(v) => actions.patchSite({ title: v })} /></Field>
          <Field label="Meta description"><TextAreaField value={site.metaDescription} onChange={(v) => actions.patchSite({ metaDescription: v })} rows={2} /></Field>
          <Field label="Social preview image (URL)"><TextField value={site.ogImageUrl || ""} onChange={(v) => actions.patchSite({ ogImageUrl: v })} placeholder="https://…" /></Field>

          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
          {publishedUrl && (
            <div className="rounded-xl border border-teal/40 bg-teal/10 p-3">
              <p className="text-xs font-semibold text-teal">{alreadyPublished ? "Live!" : "Published!"}</p>
              <div className="mt-2 flex items-center gap-2">
                <input readOnly value={publishedUrl} className="flex-1 rounded-lg border border-white/12 bg-white/5 px-2 py-1.5 text-xs text-cream" />
                <button type="button" onClick={() => { navigator.clipboard?.writeText(publishedUrl); setCopied(true); setTimeout(() => setCopied(false), 1400); }} className="rounded-lg border border-white/12 px-2 py-1.5 text-cream hover:bg-white/8">{copied ? <Check size={14} className="text-teal" /> : <Copy size={14} />}</button>
                <a href={publishedUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-white/12 px-2 py-1.5 text-cream hover:bg-white/8"><ExternalLink size={14} /></a>
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-white/10 p-5">
          <button type="button" onClick={onPublish} disabled={publishing} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet to-[#9a6a08] px-5 py-3 text-sm font-semibold text-white shadow-[0_0_22px_rgba(194,135,11,0.4)] disabled:opacity-60">
            {publishing ? <Loader2 size={16} className="animate-spin" /> : <Globe size={16} />}
            {alreadyPublished ? "Update published site" : "Publish now"}
          </button>
        </div>
      </div>
    </>
  );
}
