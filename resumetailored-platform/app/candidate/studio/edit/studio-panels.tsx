"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Eye, EyeOff, GripVertical, Trash2, Copy, ChevronUp, ChevronDown, X, ExternalLink,
  Check, Loader2, Type, Image as ImageIcon, Video, Square, Minus, MoveVertical, Share2, Download,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, Globe, Layers,
  Brush, Star, Quote, Hash, MessageSquareQuote, LayoutGrid, Music, Code2, Mic, Square as StopIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ROOT_DOMAIN } from "@/lib/subdomain";
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
function ImagePicker({ onPick, label }: { onPick: (dataUrl: string) => void; label?: string }) {
  const t = useTranslations("webStudio.panels");
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(await imageToDataUrl(f)); }} />
      <button type="button" onClick={() => ref.current?.click()} className="w-full rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs text-white/70 hover:bg-white/5">{label ?? t("upload")}</button>
    </>
  );
}
/** Upload any media file (video/audio) to a data URL, with a size guard. */
function ImagePickerAny({ onPick, label, accept }: { onPick: (dataUrl: string) => void; label: string; accept: string }) {
  const t = useTranslations("webStudio.panels");
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  return (
    <>
      <input ref={ref} type="file" accept={accept} hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; const d = await fileToDataUrl(f); if (d) { setErr(""); onPick(d); } else setErr(t("fileTooLarge")); }} />
      <button type="button" onClick={() => ref.current?.click()} className="w-full rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs text-white/70 hover:bg-white/5">{label}</button>
      {err && <p className="mt-1 text-[11px] text-amber-300">{err}</p>}
    </>
  );
}
/** Audio source: URL field + upload + in-browser recording (MediaRecorder). */
function AudioSource({ el, onSet }: { el: StudioElement; onSet: (url: string) => void }) {
  const t = useTranslations("webStudio.panels");
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
        if (blob.size > 6_000_000) { setErr(t("recordingTooLong")); return; }
        const d = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob); });
        onSet(d);
      };
      mr.start();
      recRef.current = mr;
      setRecording(true);
      mr.addEventListener("stop", () => setRecording(false));
    } catch { setErr(t("micUnavailable")); }
  }
  return (
    <div className="space-y-2">
      <Field label={t("audioUrl")}><TextField value={el.content} onChange={onSet} placeholder="https://… .mp3" /></Field>
      <ImagePickerAny accept="audio/*" onPick={onSet} label={t("uploadAudio")} />
      <button type="button" onClick={toggleRecord} className={cn("flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium", recording ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-white/20 text-white/70 hover:bg-white/5")}>
        {recording ? <><StopIcon size={13} /> {t("stopRecording")}</> : <><Mic size={13} /> {t("recordVoiceover")}</>}
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
  const t = useTranslations("webStudio.panels");
  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <Layers size={15} className="text-violet" />
        <span className="text-sm font-semibold text-cream">{t("sections")}</span>
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
              <button type="button" title={sec.visible ? t("hide") : t("show")} onClick={(e) => { e.stopPropagation(); actions.toggleSectionVisible(sec.id); }} className="shrink-0 text-white/40 hover:text-cream">
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
  const t = useTranslations("webStudio.panels");
  const th = site.theme;
  const fontOpts = FONT_CHOICES.map((f) => ({ value: f.name, label: f.name }));
  return (
    <div className="flex h-full flex-col">
      <PanelHead icon={<Globe size={15} className="text-violet" />} title={t("pageTheme")} />
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Field label={t("pageTitle")}><TextField value={site.title} onChange={(v) => actions.patchSite({ title: v })} placeholder={t("pageTitlePh")} /></Field>
        <Field label={t("metaDescription")}><TextAreaField value={site.metaDescription} onChange={(v) => actions.patchSite({ metaDescription: v })} rows={2} placeholder={t("metaDescriptionPh")} /></Field>
        <Field label={t("favicon")}>
          <div className="flex items-center gap-2">
            {site.faviconUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={site.faviconUrl} alt="" className="h-8 w-8 rounded border border-white/12" />
            )}
            <div className="flex-1"><ImagePicker onPick={(d) => actions.patchSite({ faviconUrl: d })} label={site.faviconUrl ? t("replaceFavicon") : t("uploadFavicon")} /></div>
            {site.faviconUrl && <button type="button" onClick={() => actions.patchSite({ faviconUrl: "" })} className="text-white/40 hover:text-red-300"><X size={16} /></button>}
          </div>
        </Field>
        <Field label={t("socialImage")}><TextField value={site.ogImageUrl || ""} onChange={(v) => actions.patchSite({ ogImageUrl: v })} placeholder="https://…" /></Field>
        <div className="my-1 border-t border-white/10" />
        <Field label={t("headingFont")}><SelectField value={th.headingFont} onChange={(v) => actions.patchTheme({ headingFont: v })} options={fontOpts} /></Field>
        <Field label={t("bodyFont")}><SelectField value={th.bodyFont} onChange={(v) => actions.patchTheme({ bodyFont: v })} options={fontOpts} /></Field>
        <Field label={t("primaryAccent")}><ColorField value={th.primaryColor} onChange={(v) => actions.patchTheme({ primaryColor: v })} /></Field>
        <Field label={t("secondaryAccent")}><ColorField value={th.secondaryColor} onChange={(v) => actions.patchTheme({ secondaryColor: v })} /></Field>
        <Field label={t("textColor")}><ColorField value={th.textColor} onChange={(v) => actions.patchTheme({ textColor: v })} /></Field>
        <Field label={t("bgColor")}><ColorField value={th.bgColor} onChange={(v) => actions.patchTheme({ bgColor: v })} /></Field>
        <div className="my-1 border-t border-white/10" />
        <Toggle checked={site.animate !== false} onChange={(v) => actions.patchSite({ animate: v })} label={t("fadeIn")} />

        {/* Background music (global, loops across the whole site) */}
        <details className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-cream"><Music size={14} className="text-violet" /> {t("bgMusic")}</summary>
          <div className="mt-3 space-y-3">
            <Field label={t("musicUrl")}><TextField value={site.music?.url || ""} onChange={(v) => actions.patchSite({ music: { url: v, autoplay: site.music?.autoplay ?? false, loop: site.music?.loop ?? true, volume: site.music?.volume ?? 0.6 } })} placeholder="https://… .mp3" /></Field>
            <ImagePickerAny accept="audio/*" label={t("uploadMp3")} onPick={(d) => actions.patchSite({ music: { url: d, autoplay: site.music?.autoplay ?? false, loop: site.music?.loop ?? true, volume: site.music?.volume ?? 0.6 } })} />
            {site.music?.url && (
              <>
                <Toggle checked={site.music.autoplay} onChange={(v) => actions.patchSite({ music: { ...site.music!, autoplay: v } })} label={t("musicAutoplay")} />
                <Toggle checked={site.music.loop !== false} onChange={(v) => actions.patchSite({ music: { ...site.music!, loop: v } })} label={t("loop")} />
                <Field label={t("volume", { value: `${Math.round((site.music.volume ?? 0.6) * 100)}%` })}><Slider value={Math.round((site.music.volume ?? 0.6) * 100)} onChange={(v) => actions.patchSite({ music: { ...site.music!, volume: v / 100 } })} min={0} max={100} suffix="%" /></Field>
                <button type="button" onClick={() => actions.patchSite({ music: undefined })} className="text-xs text-white/50 hover:text-red-300">{t("removeMusic")}</button>
              </>
            )}
          </div>
        </details>

        <Field label={t("customCss")}><TextAreaField value={site.customCss || ""} onChange={(v) => actions.patchSite({ customCss: v })} rows={4} mono placeholder=".rt-sec h1{ letter-spacing:-.02em }" /></Field>
        <p className="text-[11px] text-white/35">{t("tip")}</p>
      </div>
    </div>
  );
}

// ── Section panel ──
function BackgroundEditor({ section, actions }: { section: StudioSection; actions: StudioActions }) {
  const t = useTranslations("webStudio.panels");
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
        options={[{ value: "solid", label: t("color") }, { value: "gradient", label: t("gradient") }, { value: "pattern", label: t("pattern") }, { value: "image", label: t("image") }, { value: "video", label: t("video") }]}
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
        <Seg value={bg.value} onChange={(v) => actions.setSectionBg(section.id, { type: "pattern", value: v })} options={PATTERNS.map((p) => ({ value: p, label: t(`patterns.${p}`) }))} />
      )}
      {bg.type === "image" && (
        <div className="space-y-2">
          <TextField value={bg.value} onChange={(v) => actions.setSectionBg(section.id, { type: "image", value: v })} placeholder={t("bgImagePh")} />
          <ImagePicker onPick={(d) => actions.setSectionBg(section.id, { type: "image", value: d })} label={t("uploadBgImage")} />
        </div>
      )}
      {bg.type === "video" && <TextField value={bg.value} onChange={(v) => actions.setSectionBg(section.id, { type: "video", value: v })} placeholder={t("bgVideoPh")} />}
    </div>
  );
}

function ElementActionsRow({ section, element, actions }: { section: StudioSection; element: StudioElement; actions: StudioActions }) {
  const t = useTranslations("webStudio.panels");
  return (
    <div className="flex items-center gap-1.5 border-t border-white/10 pt-3">
      <button type="button" title={t("moveUp")} onClick={() => actions.moveElement(section.id, element.id, -1)} className="rounded-md border border-white/12 p-1.5 text-white/60 hover:bg-white/5"><ChevronUp size={15} /></button>
      <button type="button" title={t("moveDown")} onClick={() => actions.moveElement(section.id, element.id, 1)} className="rounded-md border border-white/12 p-1.5 text-white/60 hover:bg-white/5"><ChevronDown size={15} /></button>
      <button type="button" title={t("duplicate")} onClick={() => actions.duplicateElement(section.id, element.id)} className="rounded-md border border-white/12 p-1.5 text-white/60 hover:bg-white/5"><Copy size={15} /></button>
      <button type="button" title={t("delete")} onClick={() => actions.deleteElement(section.id, element.id)} className="ml-auto rounded-md border border-red-500/30 p-1.5 text-red-300 hover:bg-red-500/10"><Trash2 size={15} /></button>
    </div>
  );
}

function SectionPanel({ section, actions }: PanelProps & { section: StudioSection }) {
  const t = useTranslations("webStudio.panels");
  return (
    <div className="flex h-full flex-col">
      <PanelHead icon={<Square size={15} className="text-violet" />} title={t("section")} />
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Field label={t("sectionName")}><TextField value={section.name} onChange={(v) => actions.patchSection(section.id, { name: v })} /></Field>
        <Field label={t("background")}><BackgroundEditor section={section} actions={actions} /></Field>
        <Field label={t("layout")}>
          <Seg value={section.layout} onChange={(v) => actions.patchSection(section.id, { layout: v })} options={[{ value: "full", label: t("layoutFull") }, { value: "contained", label: t("layoutContained") }, { value: "split", label: t("layoutSplit") }]} />
        </Field>
        <Field label={t("paddingTop", { value: `${section.padding.top}px` })}><Slider value={section.padding.top} onChange={(v) => actions.patchSection(section.id, { padding: { ...section.padding, top: v } })} min={0} max={200} suffix="px" /></Field>
        <Field label={t("paddingBottom", { value: `${section.padding.bottom}px` })}><Slider value={section.padding.bottom} onChange={(v) => actions.patchSection(section.id, { padding: { ...section.padding, bottom: v } })} min={0} max={200} suffix="px" /></Field>
        <Toggle checked={section.visible} onChange={() => actions.toggleSectionVisible(section.id)} label={t("visible")} />
        <div className="flex items-center gap-1.5 border-t border-white/10 pt-3">
          <button type="button" onClick={() => actions.moveSection(section.id, -1)} className="rounded-md border border-white/12 p-1.5 text-white/60 hover:bg-white/5"><ChevronUp size={15} /></button>
          <button type="button" onClick={() => actions.moveSection(section.id, 1)} className="rounded-md border border-white/12 p-1.5 text-white/60 hover:bg-white/5"><ChevronDown size={15} /></button>
          <button type="button" onClick={() => actions.duplicateSection(section.id)} className="inline-flex items-center gap-1 rounded-md border border-white/12 px-2 py-1.5 text-xs text-white/70 hover:bg-white/5"><Copy size={14} /> {t("duplicate")}</button>
          <button type="button" onClick={() => actions.deleteSection(section.id)} className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1.5 text-xs text-red-300 hover:bg-red-500/10"><Trash2 size={14} /> {t("delete")}</button>
        </div>
      </div>
    </div>
  );
}

// ── Shared "paint-brush" style & effects block (any element) ──
function StyleEffects({ el, setStyle, setProps }: { el: StudioElement; setStyle: (s: Record<string, string>) => void; setProps: (p: Record<string, string | number | boolean>) => void }) {
  const t = useTranslations("webStudio.panels");
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
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-cream"><Brush size={14} className="text-violet" /> {t("styleEffects")}</summary>
      <div className="mt-3 space-y-3">
        <Field label={t("border")}><Seg value={borderStyle} onChange={(v) => setStyle({ borderStyle: v, ...(v !== "none" ? { borderWidth: el.styles.borderWidth || "1px", borderColor: el.styles.borderColor || "#e5e5e5" } : {}) })} options={[{ value: "none", label: t("none") }, { value: "solid", label: t("solid") }, { value: "dashed", label: t("dashed") }, { value: "dotted", label: t("dotted") }]} /></Field>
        {borderStyle !== "none" && (
          <>
            <Field label={t("borderWidth", { value: `${px(el.styles.borderWidth, 1)}px` })}><Slider value={px(el.styles.borderWidth, 1)} onChange={(v) => setStyle({ borderWidth: `${v}px` })} min={1} max={12} suffix="px" /></Field>
            <Field label={t("borderColor")}><ColorField value={String(el.styles.borderColor || "#e5e5e5")} onChange={(v) => setStyle({ borderColor: v })} /></Field>
          </>
        )}
        <Field label={t("cornerRadius", { value: `${px(el.styles.borderRadius, 0)}px` })}><Slider value={px(el.styles.borderRadius, 0)} onChange={(v) => setStyle({ borderRadius: `${v}px` })} min={0} max={60} suffix="px" /></Field>
        <Toggle checked={shadowOn} onChange={(v) => applyShadow(v, shadowI)} label={t("boxShadow")} />
        {shadowOn && <Field label={t("shadowIntensity", { value: `${shadowI}` })}><Slider value={shadowI} onChange={(v) => applyShadow(true, v)} min={1} max={10} /></Field>}
        <Field label={t("padding", { value: `${px(el.styles.padding, 0)}px` })}><Slider value={px(el.styles.padding, 0)} onChange={(v) => setStyle({ padding: `${v}px` })} min={0} max={80} suffix="px" /></Field>
        <Field label={t("margin", { value: `${px(el.styles.margin, 0)}px` })}><Slider value={px(el.styles.margin, 0)} onChange={(v) => setStyle({ margin: `${v}px` })} min={0} max={80} suffix="px" /></Field>
        <Field label={t("background")}>
          <div className="flex items-center gap-2">
            <ColorField value={String(el.styles.background || "").startsWith("#") ? String(el.styles.background) : "#ffffff"} onChange={(v) => setStyle({ background: v })} />
            <button type="button" onClick={() => setStyle({ background: "" })} className="shrink-0 rounded-md border border-white/12 px-2 py-1.5 text-xs text-white/60 hover:bg-white/5">{t("clear")}</button>
          </div>
        </Field>
        <div className="border-t border-white/10 pt-3" />
        <Field label={t("animOnScroll")}><SelectField value={String(el.props.anim || "")} onChange={(v) => setProps({ anim: v })} options={[{ value: "", label: t("animDefault") }, ...ANIM_CHOICES.map((a) => ({ value: a.value, label: a.label }))]} /></Field>
        <Field label={t("delay", { value: `${Number(el.props.animDelay) || 0}ms` })}><Slider value={Number(el.props.animDelay) || 0} onChange={(v) => setProps({ animDelay: v })} min={0} max={1500} step={50} suffix="ms" /></Field>
        <Field label={t("duration", { value: `${Number(el.props.animDuration) || 600}ms` })}><Slider value={Number(el.props.animDuration) || 600} onChange={(v) => setProps({ animDuration: v })} min={150} max={2000} step={50} suffix="ms" /></Field>
      </div>
    </details>
  );
}

// ── Element panel (per type) ──
function ElementPanel({ section, element: el, actions, videos }: PanelProps & { section: StudioSection; element: StudioElement }) {
  const t = useTranslations("webStudio.panels");
  const sid = section.id, eid = el.id;
  const setStyle = (s: Record<string, string>) => actions.patchElementStyle(sid, eid, s);
  const setProps = (p: Record<string, string | number | boolean>) => actions.patchElementProps(sid, eid, p);

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
      <PanelHead icon={typeIcon[el.type]} title={t(`types.${el.type}`)} />
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {(el.type === "heading" || el.type === "text" || el.type === "quote" || el.type === "icon") && (
          <>
            {el.type === "icon" && <p className="text-[11px] text-white/40">{t("iconHint")}</p>}
            {el.type === "heading" && (
              <Field label={t("level")}><Seg value={String(el.props.level || 2)} onChange={(v) => setProps({ level: Number(v) })} options={[{ value: "1", label: "H1" }, { value: "2", label: "H2" }, { value: "3", label: "H3" }]} /></Field>
            )}
            {el.type === "quote" && <Field label={t("attribution")}><TextField value={String(el.props.cite || "")} onChange={(v) => setProps({ cite: v })} placeholder={t("attributionPh")} /></Field>}
            <Field label={t("font")}><SelectField value={String(el.styles.fontFamily || "")} onChange={(v) => setStyle({ fontFamily: v })} options={[{ value: "", label: t("themeDefault") }, ...FONT_CHOICES.map((f) => ({ value: f.stack, label: f.name }))]} /></Field>
            <Field label={t("fontSize", { value: `${px(el.styles.fontSize, 17)}px` })}><Slider value={px(el.styles.fontSize, 17)} onChange={(v) => setStyle({ fontSize: `${v}px` })} min={10} max={140} suffix="px" /></Field>
            <Field label={t("fontWeight")}><SelectField value={String(el.styles.fontWeight || "")} onChange={(v) => setStyle({ fontWeight: v })} options={[{ value: "", label: t("weightDefault") }, { value: "300", label: t("weightLight") }, { value: "400", label: t("weightNormal") }, { value: "600", label: t("weightSemibold") }, { value: "700", label: t("weightBold") }, { value: "900", label: t("weightBlack") }]} /></Field>
            <Field label={t("color")}><ColorField value={String(el.styles.color || "").startsWith("#") ? String(el.styles.color) : "#1a1a1a"} onChange={(v) => setStyle({ color: v })} /></Field>
            <Field label={t("alignment")}><Seg value={String(el.styles.textAlign || "left")} onChange={(v) => setStyle({ textAlign: v })} options={alignOpts} /></Field>
            <Field label={t("lineHeight", { value: `${num(el.styles.lineHeight, el.type === "heading" ? 1.12 : 1.65)}` })}><Slider value={num(el.styles.lineHeight, el.type === "heading" ? 1.12 : 1.65)} onChange={(v) => setStyle({ lineHeight: String(v) })} min={0.9} max={2.4} step={0.05} /></Field>
            <Field label={t("letterSpacing", { value: `${num(el.styles.letterSpacing, 0)}em` })}><Slider value={num(el.styles.letterSpacing, 0)} onChange={(v) => setStyle({ letterSpacing: `${v}em` })} min={-0.05} max={0.4} step={0.01} suffix="em" /></Field>
            <Field label={t("transform")}><SelectField value={String(el.styles.textTransform || "none")} onChange={(v) => setStyle({ textTransform: v })} options={[{ value: "none", label: t("none") }, { value: "uppercase", label: t("upper") }, { value: "capitalize", label: t("capitalize") }, { value: "lowercase", label: t("lower") }]} /></Field>
          </>
        )}

        {el.type === "image" && (
          <>
            <Field label={t("image")}><ImagePicker onPick={(d) => actions.setElementContent(sid, eid, d)} label={el.content ? t("replaceImage") : t("uploadImage")} /></Field>
            <Field label={t("orImageUrl")}><TextField value={el.content} onChange={(v) => actions.setElementContent(sid, eid, v)} placeholder="https://…" /></Field>
            <Field label={t("altText")}><TextField value={String(el.props.alt || "")} onChange={(v) => setProps({ alt: v })} placeholder={t("altPh")} /></Field>
            <Field label={t("cornerRadius", { value: `${px(String(el.props.radius), 14)}px` })}><Slider value={px(String(el.props.radius), 14)} onChange={(v) => setProps({ radius: v })} min={0} max={60} suffix="px" /></Field>
            <Toggle checked={el.props.shadow !== false} onChange={(v) => setProps({ shadow: v })} label={t("dropShadow")} />
            <Field label={t("fit")}><Seg value={String(el.props.fit || "cover")} onChange={(v) => setProps({ fit: v })} options={[{ value: "cover", label: t("fitCover") }, { value: "contain", label: t("fitContain") }, { value: "original", label: t("fitOriginal") }]} /></Field>
            <Field label={t("onClick")}><SelectField value={String(el.props.behavior || "none")} onChange={(v) => setProps({ behavior: v })} options={[{ value: "none", label: t("nothing") }, { value: "link", label: t("openLink") }]} /></Field>
            {el.props.behavior === "link" && <Field label={t("linkUrl")}><TextField value={String(el.props.url || "")} onChange={(v) => setProps({ url: v })} placeholder="https://…" /></Field>}
          </>
        )}

        {el.type === "video" && (
          <>
            <Field label={t("videoUrl")}><TextField value={el.content} onChange={(v) => actions.setElementContent(sid, eid, v)} placeholder="https://youtu.be/…" /></Field>
            <Field label={t("uploadVideoFile")}><ImagePickerAny accept="video/*" onPick={(d) => actions.setElementContent(sid, eid, d)} label={t("uploadVideo")} /></Field>
            {videos.length > 0 && (
              <Field label={t("useMyVideo")}>
                <SelectField value="" onChange={(v) => { if (v) actions.setElementContent(sid, eid, v); }} options={[{ value: "", label: t("chooseVideo") }, ...videos.map((vv) => ({ value: vv.videoUrl, label: vv.title }))]} />
              </Field>
            )}
            <Toggle checked={el.props.autoplay === true} onChange={(v) => setProps({ autoplay: v })} label={t("autoplay")} />
            <Toggle checked={el.props.mute !== false} onChange={(v) => setProps({ mute: v })} label={t("muted")} />
            <Toggle checked={el.props.loop === true} onChange={(v) => setProps({ loop: v })} label={t("loop")} />
            <Field label={t("posterUrl")}><TextField value={String(el.props.poster || "")} onChange={(v) => setProps({ poster: v })} placeholder="https://…" /></Field>
            <Field label={t("alignment")}><Seg value={String(el.styles.textAlign || "left")} onChange={(v) => setStyle({ textAlign: v })} options={alignOpts} /></Field>
          </>
        )}

        {(el.type === "button" || el.type === "resume-download") && (
          <>
            <Field label={t("types.text")}><TextField value={el.content} onChange={(v) => actions.setElementContent(sid, eid, v)} /></Field>
            <Field label={el.type === "resume-download" ? t("resumeFileUrl") : t("linkUrl")}><TextField value={String(el.props.url || "")} onChange={(v) => setProps({ url: v })} placeholder="https://…" /></Field>
            <Field label={t("style")}><Seg value={String(el.props.variant || "solid")} onChange={(v) => setProps({ variant: v })} options={[{ value: "solid", label: t("solid") }, { value: "outline", label: t("variantOutline") }, { value: "ghost", label: t("variantGhost") }]} /></Field>
            <Field label={t("cornerRadius", { value: `${px(String(el.props.radius), 10)}px` })}><Slider value={px(String(el.props.radius), 10)} onChange={(v) => setProps({ radius: v })} min={0} max={40} suffix="px" /></Field>
            <Field label={t("alignment")}><Seg value={String(el.styles.textAlign || "left")} onChange={(v) => setStyle({ textAlign: v })} options={alignOpts} /></Field>
          </>
        )}

        {el.type === "social" && (
          <>
            {(["linkedin", "github", "twitter", "website"] as const).map((k) => (
              <Field key={k} label={t(`social.${k}`)}><TextField value={String(el.props[k] || "")} onChange={(v) => setProps({ [k]: v })} placeholder="https://…" /></Field>
            ))}
            <Field label={t("social.email")}><TextField value={String(el.props.email || "")} onChange={(v) => setProps({ email: v })} placeholder="you@example.com" /></Field>
            <Field label={t("alignment")}><Seg value={String(el.styles.textAlign || "left")} onChange={(v) => setStyle({ textAlign: v })} options={alignOpts} /></Field>
          </>
        )}

        {el.type === "stat" && (
          <>
            <Field label={t("value")}><TextField value={String(el.props.value || "")} onChange={(v) => setProps({ value: v })} placeholder="200+" /></Field>
            <Field label={t("label")}><TextField value={String(el.props.label || "")} onChange={(v) => setProps({ label: v })} placeholder={t("statLabelPh")} /></Field>
            <Field label={t("alignment")}><Seg value={String(el.styles.textAlign || "center")} onChange={(v) => setStyle({ textAlign: v })} options={alignOpts} /></Field>
          </>
        )}

        {el.type === "testimonial" && (
          <>
            <Field label={t("types.quote")}><TextAreaField value={String(el.props.quote || "")} onChange={(v) => setProps({ quote: v })} rows={3} /></Field>
            <Field label={t("author")}><TextField value={String(el.props.author || "")} onChange={(v) => setProps({ author: v })} /></Field>
            <Field label={t("roleCompany")}><TextField value={String(el.props.role || "")} onChange={(v) => setProps({ role: v })} /></Field>
            <Field label={t("avatar")}><ImagePicker onPick={(d) => setProps({ avatar: d })} label={el.props.avatar ? t("replaceAvatar") : t("uploadAvatar")} /></Field>
          </>
        )}

        {el.type === "gallery" && (
          <>
            <Field label={t("addImages")}><ImagePicker onPick={(d) => actions.setElementContent(sid, eid, (el.content ? el.content + "\n" : "") + d)} label={t("uploadToGallery")} /></Field>
            <Field label={t("imageUrls")}><TextAreaField value={el.content} onChange={(v) => actions.setElementContent(sid, eid, v)} rows={4} placeholder={"https://…\nhttps://…"} /></Field>
            <Field label={t("columns", { value: `${Number(el.props.columns) || 3}` })}><Slider value={Number(el.props.columns) || 3} onChange={(v) => setProps({ columns: v })} min={1} max={6} /></Field>
            <Field label={t("gap", { value: `${Number(el.props.gap ?? 12)}px` })}><Slider value={Number(el.props.gap ?? 12)} onChange={(v) => setProps({ gap: v })} min={0} max={40} suffix="px" /></Field>
            <Field label={t("cornerRadius", { value: `${Number(el.props.radius ?? 12)}px` })}><Slider value={Number(el.props.radius ?? 12)} onChange={(v) => setProps({ radius: v })} min={0} max={40} suffix="px" /></Field>
          </>
        )}

        {el.type === "audio" && (
          <>
            <AudioSource el={el} onSet={(url) => actions.setElementContent(sid, eid, url)} />
            <Field label={t("labelOptional")}><TextField value={String(el.props.label || "")} onChange={(v) => setProps({ label: v })} placeholder={t("audioLabelPh")} /></Field>
            <Toggle checked={el.props.autoplay === true} onChange={(v) => setProps({ autoplay: v })} label={t("audioAutoplay")} />
            <Toggle checked={el.props.loop === true} onChange={(v) => setProps({ loop: v })} label={t("loop")} />
          </>
        )}

        {el.type === "embed" && (
          <>
            <Field label={t("embedUrl")}><TextField value={el.content} onChange={(v) => actions.setElementContent(sid, eid, v)} placeholder="https://…" /></Field>
            <Field label={t("height", { value: `${Number(el.props.height) || 360}px` })}><Slider value={Number(el.props.height) || 360} onChange={(v) => setProps({ height: v })} min={120} max={900} step={20} suffix="px" /></Field>
            <p className="text-[11px] text-white/40">{t("embedHint")}</p>
          </>
        )}

        {el.type === "divider" && (
          <>
            <Field label={t("color")}><ColorField value={String(el.styles.background || "").startsWith("#") ? String(el.styles.background) : "#888888"} onChange={(v) => setStyle({ background: v, opacity: "1" })} /></Field>
            <Field label={t("thickness", { value: `${px(el.styles.height, 1)}px` })}><Slider value={px(el.styles.height, 1)} onChange={(v) => setStyle({ height: `${v}px` })} min={1} max={12} suffix="px" /></Field>
          </>
        )}

        {el.type === "spacer" && (
          <Field label={t("height", { value: `${Number(el.props.height) || 40}px` })}><Slider value={Number(el.props.height) || 40} onChange={(v) => setProps({ height: v })} min={4} max={240} suffix="px" /></Field>
        )}

        {el.type !== "spacer" && <StyleEffects el={el} setStyle={setStyle} setProps={setProps} />}
        <ElementActionsRow section={section} element={el} actions={actions} />
      </div>
    </div>
  );
}

// ── Floating "+" Add menu ──────────────────────────────────────────────────────

export function AddMenu({ onAddSection, onAddElement, onClose }: { onAddSection: (t: SectionType) => void; onAddElement: (t: ElementType) => void; onClose: () => void }) {
  const t = useTranslations("webStudio.panels");
  const elementTypes: ElementType[] = ["heading", "text", "image", "video", "button", "divider", "spacer", "social", "resume-download", "icon", "quote", "stat", "testimonial", "gallery", "audio", "embed"];
  return (
    <>
      <div className="fixed inset-0 z-[150]" onClick={onClose} />
      <div className="fixed bottom-24 left-1/2 z-[151] max-h-[70vh] w-[min(560px,92vw)] -translate-x-1/2 overflow-y-auto rounded-2xl border border-white/12 bg-[#12141d] p-4 shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-cream">{t("addSection")}</h3>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-cream"><X size={16} /></button>
        </div>
        <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {SECTION_CHOICES.map((s) => (
            <button key={s.type} type="button" onClick={() => onAddSection(s.type)} className="rounded-lg border border-white/12 bg-white/5 px-2 py-2.5 text-xs font-medium text-cream hover:border-violet hover:bg-violet/10">{t(`sectionTypes.${s.type}`)}</button>
          ))}
        </div>
        <h3 className="mb-2 text-sm font-semibold text-cream">{t("addElement")}</h3>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {elementTypes.map((ty) => (
            <button key={ty} type="button" onClick={() => onAddElement(ty)} className="rounded-lg border border-white/12 bg-white/5 px-2 py-2.5 text-xs font-medium text-cream hover:border-violet hover:bg-violet/10">{t(`add.${ty}`)}</button>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-white/35">{t("addHint")}</p>
      </div>
    </>
  );
}

// ── Publish slide-out ──────────────────────────────────────────────────────────

export function PublishPanel({
  site, slug, setSlug, slugStatus = "idle", publishing, publishedUrl, alreadyPublished, error, onPublish, onClose, actions,
}: {
  site: StudioSite;
  slug: string;
  setSlug: (v: string) => void;
  slugStatus?: "idle" | "checking" | "available" | "taken" | "invalid";
  publishing: boolean;
  publishedUrl: string | null;
  alreadyPublished: boolean;
  error: string | null;
  onPublish: () => void;
  onClose: () => void;
  actions: StudioActions;
}) {
  const t = useTranslations("webStudio.panels");
  const [copied, setCopied] = useState(false);
  const shown = slug || t("addressPh");
  const subdomainUrl = `${shown}.${ROOT_DOMAIN}`;
  const pathUrl = `app.${ROOT_DOMAIN}/site/${shown}`;
  return (
    <>
      <div className="fixed inset-0 z-[160] bg-black/40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-[161] flex w-[min(420px,100vw)] flex-col border-l border-white/12 bg-[#0f1119] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h3 className="font-serif text-lg text-cream">{t("publishTitle")}</h3>
          <button type="button" onClick={onClose} className="text-white/45 hover:text-cream"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <Field label={t("siteUrl")}>
            <div className="rounded-lg border border-white/12 bg-white/5 px-2.5 py-2">
              <span className="block truncate text-sm text-cream">{subdomainUrl}</span>
              <span className="mt-0.5 block truncate text-[11px] text-white/35">{t("alsoAt", { url: pathUrl })}</span>
            </div>
          </Field>
          <Field label={t("customAddress")}><TextField value={slug} onChange={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder={t("addressPh")} /></Field>
          <div className="-mt-2 text-[11px]">
            {slugStatus === "checking" && <span className="text-white/45">{t("checking")}</span>}
            {slugStatus === "available" && <span className="text-teal">{t("available", { url: subdomainUrl })}</span>}
            {slugStatus === "taken" && <span className="text-red-300">{t("taken")}</span>}
            {slugStatus === "invalid" && <span className="text-red-300">{t("slugRules")}</span>}
            {slugStatus === "idle" && <span className="text-white/35">{t("slugRules")}</span>}
          </div>
          <div className="my-1 border-t border-white/10" />
          <Field label={t("seoTitle")}><TextField value={site.title} onChange={(v) => actions.patchSite({ title: v })} /></Field>
          <Field label={t("metaDescription")}><TextAreaField value={site.metaDescription} onChange={(v) => actions.patchSite({ metaDescription: v })} rows={2} /></Field>
          <Field label={t("socialImage")}><TextField value={site.ogImageUrl || ""} onChange={(v) => actions.patchSite({ ogImageUrl: v })} placeholder="https://…" /></Field>

          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
          {publishedUrl && (
            <div className="rounded-xl border border-teal/40 bg-teal/10 p-3">
              <p className="text-xs font-semibold text-teal">{alreadyPublished ? t("live") : t("published")}</p>
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
            {alreadyPublished ? t("updatePublished") : t("publishNow")}
          </button>
        </div>
      </div>
    </>
  );
}
