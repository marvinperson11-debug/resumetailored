"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bold, Italic, Underline, Link2, List, Heading1, Heading2, Heading3, ImagePlus, EyeOff, Plus,
} from "lucide-react";
import {
  type StudioSite, type StudioSection, type StudioElement,
  sectionWrapStyle, sectionInnerStyle, elementStyle, themeVars, sanitizeRichText, safeUrl, fontStack,
} from "@/lib/studio-types";
import { type Selection, type StudioActions, type Device, DEVICE_WIDTH, imageToDataUrl } from "./studio-shared";

interface CanvasProps {
  site: StudioSite;
  selection: Selection;
  device: Device;
  editingId: string | null;
  onSelect: (sel: Selection) => void;
  onBeginTextEdit: (secId: string, elId: string) => void;
  onEndTextEdit: () => void;
  onAddElementInSection: (secId: string) => void;
  actions: StudioActions;
}

const isSel = (sel: Selection, secId: string, elId?: string) =>
  elId
    ? sel.kind === "element" && sel.elementId === elId
    : sel.kind === "section" && sel.sectionId === secId;

export function StudioCanvas(props: CanvasProps) {
  const { site, device } = props;
  const width = DEVICE_WIDTH[device];
  const scalerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Fit the fixed-width canvas into the available center column via transform.
  useLayoutEffect(() => {
    const fit = () => {
      const avail = scalerRef.current?.parentElement?.clientWidth ?? width;
      setScale(Math.min(1, (avail - 8) / width));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [width]);

  const rootStyle = {
    ...(themeVars(site.theme) as Record<string, string>),
    fontFamily: fontStack(site.theme.bodyFont),
    color: site.theme.textColor,
    background: site.theme.bgColor,
    width,
    minHeight: 400,
  } as React.CSSProperties;

  return (
    <div className="flex justify-center px-2 py-6">
      <div
        ref={scalerRef}
        style={{ width: width * scale, transition: "width .15s ease" }}
      >
        <div
          style={{
            width,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <div style={rootStyle} className="rt-canvas overflow-hidden rounded-xl shadow-2xl">
            {site.sections.map((sec) => (
              <SectionView key={sec.id} section={sec} {...props} />
            ))}
            <footer style={{ padding: "22px", textAlign: "center", fontSize: 12, opacity: 0.55, borderTop: "1px solid rgba(128,128,128,.2)" }}>
              Made with ResumeTailored
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionView({ section, site, selection, editingId, onSelect, onBeginTextEdit, onEndTextEdit, onAddElementInSection, actions }: CanvasProps & { section: StudioSection }) {
  const { style, videoUrl } = sectionWrapStyle(section);
  const selected = selection.kind === "section" && selection.sectionId === section.id;
  const wrap: React.CSSProperties = {
    ...(style as React.CSSProperties),
    ...(section.visible ? {} : { opacity: 0.4 }),
    outline: selected ? "2px solid #C2870B" : "none",
    outlineOffset: -2,
    cursor: "pointer",
  };
  return (
    <section
      style={wrap}
      onClick={(e) => { e.stopPropagation(); onSelect({ kind: "section", sectionId: section.id }); }}
    >
      {videoUrl && (
        <>
          <video src={videoUrl} autoPlay muted loop playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }} />
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 0 }} />
        </>
      )}
      {!section.visible && (
        <div style={{ position: "absolute", top: 8, left: 8, zIndex: 3, display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 11, padding: "3px 8px", borderRadius: 6 }}>
          <EyeOff size={12} /> Hidden
        </div>
      )}
      <div style={{ ...(sectionInnerStyle(section) as React.CSSProperties) }}>
        {section.elements.map((el) => (
          <ElementView
            key={el.id}
            element={el}
            section={section}
            site={site}
            selection={selection}
            editingId={editingId}
            onSelect={onSelect}
            onBeginTextEdit={onBeginTextEdit}
            onEndTextEdit={onEndTextEdit}
            actions={actions}
          />
        ))}
      </div>
      {/* Add-element affordance inside the selected section */}
      {selected && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAddElementInSection(section.id); }}
          style={{ position: "relative", zIndex: 2 }}
          className="mx-auto mt-3 flex items-center gap-1.5 rounded-full bg-violet px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
        >
          <Plus size={14} /> Add element
        </button>
      )}
    </section>
  );
}

interface ElProps {
  element: StudioElement;
  section: StudioSection;
  site: StudioSite;
  selection: Selection;
  editingId: string | null;
  onSelect: (sel: Selection) => void;
  onBeginTextEdit: (secId: string, elId: string) => void;
  onEndTextEdit: () => void;
  actions: StudioActions;
}

function ElementView(p: ElProps) {
  const { element: el, section: sec, selection, editingId, onSelect, onBeginTextEdit, onEndTextEdit, actions } = p;
  const selected = isSel(selection, sec.id, el.id);
  const editing = editingId === el.id;
  const fileRef = useRef<HTMLInputElement>(null);

  const selectMe = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect({ kind: "element", sectionId: sec.id, elementId: el.id });
  };

  const wrapStyle: React.CSSProperties = {
    position: "relative",
    outline: selected && !editing ? "2px solid #C2870B" : "none",
    outlineOffset: 2,
    borderRadius: 4,
  };

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const url = await imageToDataUrl(file);
    actions.setElementContent(sec.id, el.id, url);
  }

  // ── text / heading / quote / icon (all inline-editable) ──
  if (el.type === "heading" || el.type === "text" || el.type === "quote" || el.type === "icon") {
    const tag = el.type === "heading" ? (`h${Math.min(3, Math.max(1, Number(el.props.level) || 2))}` as "h1" | "h2" | "h3") : "p";
    return (
      <div style={wrapStyle}>
        <EditableText
          tag={tag}
          html={el.content}
          editing={editing}
          style={elementStyle(el) as React.CSSProperties}
          onClick={(e) => { e.stopPropagation(); onSelect({ kind: "element", sectionId: sec.id, elementId: el.id }); if (!editing) onBeginTextEdit(sec.id, el.id); }}
          onCommit={(html) => { actions.setElementContent(sec.id, el.id, sanitizeRichText(html)); onEndTextEdit(); }}
          onSetLevel={el.type === "heading" ? (lvl) => actions.patchElementProps(sec.id, el.id, { level: lvl }) : undefined}
        />
      </div>
    );
  }

  // ── image ──
  if (el.type === "image") {
    const src = safeUrl(el.content);
    return (
      <div style={{ ...wrapStyle, textAlign: (el.styles.textAlign as React.CSSProperties["textAlign"]) || undefined }}>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickImage} />
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={String(el.props.alt || "")}
            onClick={selectMe}
            style={{
              maxWidth: "100%",
              borderRadius: Number(el.props.radius ?? 14),
              boxShadow: el.props.shadow ? "0 10px 34px rgba(0,0,0,.16)" : "none",
              objectFit: (String(el.props.fit || "cover") === "original" ? undefined : (String(el.props.fit) as "cover" | "contain")),
              ...(el.styles as React.CSSProperties),
            }}
          />
        ) : (
          <button
            type="button"
            onClick={(e) => { selectMe(e); fileRef.current?.click(); }}
            style={{ width: "100%", minHeight: 160, border: "2px dashed rgba(128,128,128,.5)", borderRadius: 14, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "inherit", opacity: 0.7, background: "rgba(128,128,128,.06)" }}
          >
            <ImagePlus size={26} />
            <span style={{ fontSize: 13 }}>Click to add an image</span>
          </button>
        )}
        {selected && src && (
          <button type="button" onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }} className="absolute right-1 top-1 z-10 rounded-md bg-violet px-2 py-1 text-[11px] font-semibold text-white shadow">
            Replace
          </button>
        )}
      </div>
    );
  }

  // ── video ──
  if (el.type === "video") {
    return (
      <div style={{ ...wrapStyle, textAlign: (el.styles.textAlign as React.CSSProperties["textAlign"]) || undefined }} onClick={selectMe}>
        <VideoView el={el} />
      </div>
    );
  }

  // ── button / resume-download ──
  if (el.type === "button" || el.type === "resume-download") {
    const variant = String(el.props.variant || "solid");
    const btnStyle: React.CSSProperties = {
      display: "inline-block",
      padding: "12px 24px",
      borderRadius: Number(el.props.radius ?? 10),
      fontWeight: 700,
      fontFamily: "var(--heading-font)",
      cursor: "pointer",
      ...(variant === "outline"
        ? { border: "2px solid var(--primary)", color: "var(--primary)", background: "transparent" }
        : variant === "ghost"
        ? { color: "var(--primary)", background: "color-mix(in srgb,var(--primary) 12%,transparent)" }
        : { background: "var(--primary)", color: "#fff", boxShadow: "0 6px 20px color-mix(in srgb,var(--primary) 35%,transparent)" }),
    };
    return (
      <div style={{ ...wrapStyle, margin: "10px 0", textAlign: (el.styles.textAlign as React.CSSProperties["textAlign"]) || "left" }} onClick={selectMe}>
        <span style={btnStyle}>{el.type === "resume-download" ? `⬇ ${el.content || "Download résumé"}` : el.content || "Button"}</span>
      </div>
    );
  }

  // ── divider ──
  if (el.type === "divider") {
    return (
      <div style={wrapStyle} onClick={selectMe}>
        <hr style={{ ...(elementStyle(el) as React.CSSProperties) }} />
      </div>
    );
  }

  // ── spacer ──
  if (el.type === "spacer") {
    return (
      <div style={{ ...wrapStyle, height: Number(el.props.height) || 40, background: selected ? "rgba(194,135,11,.08)" : "transparent" }} onClick={selectMe} />
    );
  }

  // ── social ──
  if (el.type === "social") {
    const items: string[] = [];
    (["linkedin", "github", "twitter", "website", "email"] as const).forEach((k) => {
      if (el.props[k]) items.push(k === "email" ? "Email" : k.charAt(0).toUpperCase() + k.slice(1));
    });
    const align = String(el.styles.textAlign || "left");
    return (
      <div style={{ ...wrapStyle }} onClick={selectMe}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, margin: "12px 0", justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start" }}>
          {items.length ? items.map((label) => (
            <span key={label} style={{ fontWeight: 600, borderBottom: "1px solid currentColor", paddingBottom: 1 }}>{label}</span>
          )) : <span style={{ opacity: 0.5, fontSize: 13 }}>Add your social links →</span>}
        </div>
      </div>
    );
  }

  // ── stat counter ──
  if (el.type === "stat") {
    return (
      <div style={{ ...wrapStyle, display: "inline-block", minWidth: 150, margin: 6, padding: "20px 22px", borderRadius: 18, background: "color-mix(in srgb,var(--primary) 6%,transparent)", border: "1px solid color-mix(in srgb,var(--primary) 16%,transparent)", textAlign: (el.styles.textAlign as React.CSSProperties["textAlign"]) || "center" }} onClick={selectMe}>
        <span style={{ display: "block", fontFamily: "var(--heading-font)", fontWeight: 800, fontSize: 44, lineHeight: 1, color: "var(--primary)" }}>{String(el.props.value || "")}</span>
        <span style={{ display: "block", marginTop: 8, fontSize: 14, opacity: 0.7 }}>{String(el.props.label || "")}</span>
      </div>
    );
  }

  // ── testimonial card ──
  if (el.type === "testimonial") {
    const avatar = safeUrl(el.props.avatar);
    return (
      <figure style={{ ...wrapStyle, margin: 0, padding: 26, borderRadius: 20, background: "color-mix(in srgb,var(--ink) 4%,transparent)", border: "1px solid color-mix(in srgb,var(--ink) 10%,transparent)" }} onClick={selectMe}>
        <blockquote style={{ margin: "0 0 16px", fontSize: 19, lineHeight: 1.5, fontFamily: "var(--heading-font)" }}>&ldquo;{String(el.props.quote || "")}&rdquo;</blockquote>
        <figcaption style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14, opacity: 0.85 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {avatar && <img src={avatar} alt="" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover" }} />}
          <span><strong>{String(el.props.author || "")}</strong>{el.props.role ? <><br />{String(el.props.role)}</> : null}</span>
        </figcaption>
      </figure>
    );
  }

  // ── gallery grid ──
  if (el.type === "gallery") {
    const urls = String(el.content || "").split(/\n+/).map((s) => safeUrl(s.trim())).filter(Boolean);
    const cols = Math.min(6, Math.max(1, Number(el.props.columns) || 3));
    const gap = Number(el.props.gap ?? 12);
    const radius = Number(el.props.radius ?? 12);
    return (
      <div style={{ ...wrapStyle, display: "grid", gridTemplateColumns: `repeat(${cols},1fr)`, gap }} onClick={selectMe}>
        {(urls.length ? urls : Array.from({ length: cols }).map(() => "")).map((u, i) =>
          u ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt="" style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", borderRadius: radius }} />
          ) : (
            <div key={i} style={{ aspectRatio: "1/1", borderRadius: radius, background: "color-mix(in srgb,var(--primary) 12%,transparent)", border: "1px dashed color-mix(in srgb,var(--ink) 25%,transparent)" }} />
          )
        )}
      </div>
    );
  }

  // ── audio player ──
  if (el.type === "audio") {
    const src = safeUrl(el.content);
    return (
      <div style={{ ...wrapStyle, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "10px 0", padding: "14px 16px", borderRadius: 14, background: "color-mix(in srgb,var(--primary) 7%,transparent)", border: "1px solid color-mix(in srgb,var(--primary) 20%,transparent)" }} onClick={selectMe}>
        {el.props.label ? <span style={{ fontWeight: 600 }}>{String(el.props.label)}</span> : null}
        {src ? <audio controls src={src} style={{ flex: 1, minWidth: 200, height: 36 }} /> : <span style={{ opacity: 0.5, fontSize: 13 }}>Select this block, then add an audio URL or record →</span>}
      </div>
    );
  }

  // ── embed (iframe) ──
  if (el.type === "embed") {
    const src = safeUrl(el.content);
    const h = Math.max(80, Number(el.props.height) || 360);
    return (
      <div style={{ ...wrapStyle }} onClick={selectMe}>
        {src ? (
          <iframe title="embed" src={src} style={{ width: "100%", height: h, border: 0, borderRadius: 12 }} sandbox="allow-scripts allow-same-origin allow-popups allow-forms" />
        ) : (
          <div style={{ width: "100%", height: h, border: "2px dashed rgba(128,128,128,.5)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.7, fontSize: 13 }}>Select this block, then paste an embed URL →</div>
        )}
      </div>
    );
  }

  return null;
}

function VideoView({ el }: { el: StudioElement }) {
  const url = String(el.content || "").trim();
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d{5,})/);
  const box: React.CSSProperties = { position: "relative", width: "100%", paddingTop: "56.25%", borderRadius: 14, overflow: "hidden", background: "#000", boxShadow: "0 8px 34px rgba(0,0,0,.2)" };
  const frame: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 };
  if (yt) return <div style={box}><iframe title="video" src={`https://www.youtube.com/embed/${yt[1]}`} style={frame} allowFullScreen /></div>;
  if (vm) return <div style={box}><iframe title="video" src={`https://player.vimeo.com/video/${vm[1]}`} style={frame} allowFullScreen /></div>;
  const src = safeUrl(url);
  if (src) return <video src={src} controls playsInline style={{ width: "100%", borderRadius: 14, background: "#000" }} />;
  return (
    <div style={{ width: "100%", minHeight: 180, border: "2px dashed rgba(128,128,128,.5)", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.7, background: "rgba(128,128,128,.06)", fontSize: 13 }}>
      Select this block, then paste a video URL in the panel →
    </div>
  );
}

// ── Inline contentEditable text with a floating format toolbar ──────────────────

function EditableText({
  tag, html, editing, style, onCommit, onClick, onSetLevel,
}: {
  tag: "h1" | "h2" | "h3" | "p";
  html: string;
  editing: boolean;
  style: React.CSSProperties;
  onCommit: (html: string) => void;
  onClick: (e: React.MouseEvent) => void;
  onSetLevel?: (level: 1 | 2 | 3) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);

  // Keep innerHTML in sync from state whenever we're NOT actively editing
  // (undo/redo, external content changes). While editing, the DOM is the
  // source of truth so the caret survives.
  useEffect(() => {
    if (ref.current && !editing) ref.current.innerHTML = html || "";
  }, [html, editing]);

  useEffect(() => {
    if (editing && ref.current) {
      const node = ref.current;
      node.focus();
      const r = document.createRange();
      r.selectNodeContents(node);
      r.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
  }, [editing]);

  const setRef = useCallback((node: HTMLElement | null) => {
    ref.current = node;
    if (node && node.innerHTML !== (html || "") && !editing) node.innerHTML = html || "";
  }, [html, editing]);

  const commit = () => { if (ref.current) onCommit(ref.current.innerHTML); };

  const Tag = tag as unknown as React.ElementType;
  return (
    <>
      {editing && <FloatingToolbar target={ref.current} isHeading={tag !== "p"} onDone={commit} onSetLevel={onSetLevel} />}
      <Tag
        ref={setRef}
        style={{ ...style, outline: editing ? "2px solid #C2870B" : "none", outlineOffset: 2, cursor: "text" }}
        contentEditable={editing}
        suppressContentEditableWarning
        onClick={onClick}
        onBlur={() => editing && commit()}
        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
      />
    </>
  );
}

function FloatingToolbar({ target, isHeading, onDone, onSetLevel }: { target: HTMLElement | null; isHeading: boolean; onDone: () => void; onSetLevel?: (level: 1 | 2 | 3) => void }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!target) { setPos(null); return; }
    const update = () => {
      const r = target.getBoundingClientRect();
      setPos({ top: Math.max(8, r.top - 46), left: r.left });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [target]);

  if (!pos || typeof document === "undefined") return null;
  // Keep focus in the editable: preventDefault on mousedown, then run the command.
  const run = (cmd: string, value?: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.execCommand(cmd, false, value);
    onDone();
  };
  const setLevel = (lvl: 1 | 2 | 3) => (e: React.MouseEvent) => {
    e.preventDefault();
    onDone(); // commit current text before the heading tag remounts
    onSetLevel?.(lvl);
  };
  const link = (e: React.MouseEvent) => {
    e.preventDefault();
    const url = window.prompt("Link URL (https://…)");
    if (url) document.execCommand("createLink", false, url);
    onDone();
  };

  const Btn = ({ onMouseDown, title, children }: { onMouseDown: (e: React.MouseEvent) => void; title: string; children: React.ReactNode }) => (
    <button type="button" title={title} onMouseDown={onMouseDown} className="flex h-8 w-8 items-center justify-center rounded-md text-cream hover:bg-white/15">
      {children}
    </button>
  );

  // Portal to <body>: the canvas is transform-scaled, and a `fixed` element
  // inside a transformed ancestor anchors to that ancestor, not the viewport.
  return createPortal(
    <div
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 200 }}
      className="flex items-center gap-0.5 rounded-lg border border-white/15 bg-[#171a24] p-1 shadow-2xl"
    >
      <Btn title="Bold" onMouseDown={run("bold")}><Bold size={15} /></Btn>
      <Btn title="Italic" onMouseDown={run("italic")}><Italic size={15} /></Btn>
      <Btn title="Underline" onMouseDown={run("underline")}><Underline size={15} /></Btn>
      <Btn title="Link" onMouseDown={link}><Link2 size={15} /></Btn>
      <div className="mx-0.5 h-5 w-px bg-white/15" />
      {isHeading ? (
        <>
          <Btn title="Heading 1" onMouseDown={setLevel(1)}><Heading1 size={15} /></Btn>
          <Btn title="Heading 2" onMouseDown={setLevel(2)}><Heading2 size={15} /></Btn>
          <Btn title="Heading 3" onMouseDown={setLevel(3)}><Heading3 size={15} /></Btn>
        </>
      ) : (
        <Btn title="Bullet list" onMouseDown={run("insertUnorderedList")}><List size={15} /></Btn>
      )}
    </div>,
    document.body
  );
}
