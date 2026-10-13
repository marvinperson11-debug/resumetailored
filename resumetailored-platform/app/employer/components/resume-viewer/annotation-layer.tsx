"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare, Trash2 } from "lucide-react";
import { ANNOTATION_COLORS, ANNOTATION_SWATCH, MAX_NOTE_CHARS, type AnnotationColor, type AnnotationInput, type AnnotationPatch, type ResumeAnnotation } from "@/lib/resume-annotations";

/**
 * Our own annotation layer, drawn over one rendered PDF page. It knows nothing about PDF.js: it is an absolutely
 * positioned box the size of the page, and every annotation is a fraction of that box (0..1, origin top-left), so the
 * same annotation lands on the same words at any zoom, on any screen, with any renderer. It never touches the PDF.
 *
 * Tools: `highlight` drags out a rectangle, `note` drops a pin and opens a text box, `select` lets you open, edit,
 * recolour and delete what is there. With `readOnly` (the signed-out demo) there are no tools at all: existing
 * annotations can be opened and read, nothing can be created, edited or deleted.
 */
export type LayerAnnotation = Pick<ResumeAnnotation, "id" | "page" | "x" | "y" | "w" | "h" | "kind" | "text" | "color">;
export type Tool = "select" | "highlight" | "note";

export interface AnnotationLayerProps {
  page: number;
  annotations: LayerAnnotation[];
  tool: Tool;
  color: AnnotationColor;
  readOnly: boolean;
  onCreate: (input: AnnotationInput) => Promise<boolean>;
  onUpdate: (id: string, patch: AnnotationPatch) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  /** Shown under a drag that was too small to be a highlight, etc. */
  onHint?: (msg: string | null) => void;
}

const MIN_W = 0.005;
const MIN_H = 0.003;

interface Draft {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function AnnotationLayer({ page, annotations, tool, color, readOnly, onCreate, onUpdate, onDelete, onHint }: AnnotationLayerProps) {
  const t = useTranslations("resumeViewer");
  const layer = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const activeTool: Tool = readOnly ? "select" : tool;

  // Escape closes whatever is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedId(null);
        setPending(null);
        setDraft(null);
        drag.current = null;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Leaving a tool abandons its half-finished gesture.
  useEffect(() => {
    setPending(null);
    setDraft(null);
    drag.current = null;
  }, [tool]);

  const rel = (clientX: number, clientY: number) => {
    const r = layer.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return { x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)) };
  };

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.target !== layer.current) return; // a press on an existing annotation belongs to that annotation
    setSelectedId(null);
    if (activeTool === "highlight") {
      const p = rel(e.clientX, e.clientY);
      if (!p) return;
      drag.current = { ...p, id: e.pointerId };
      setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
      try { layer.current?.setPointerCapture?.(e.pointerId); } catch { /* jsdom / old browsers */ }
      onHint?.(null);
    } else if (activeTool === "note") {
      const p = rel(e.clientX, e.clientY);
      if (p) setPending(p);
    }
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const p = rel(e.clientX, e.clientY);
    if (!p) return;
    setDraft({ x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y) });
  }
  async function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const p = rel(e.clientX, e.clientY);
    const box = p ? { x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y) } : draft;
    setDraft(null);
    if (!box) return;
    if (box.w < MIN_W || box.h < MIN_H) return onHint?.(t("errorTooSmall"));
    const ok = await onCreate({ page, kind: "highlight", text: "", color, ...box });
    if (!ok) onHint?.(t("errorSave"));
  }

  const selected = annotations.find((a) => a.id === selectedId) || null;

  return (
    <div
      ref={layer}
      data-annotation-layer={page}
      className="absolute inset-0"
      style={{ cursor: activeTool === "select" ? "default" : "crosshair", touchAction: activeTool === "highlight" ? "none" : "auto" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {annotations.map((a) =>
        a.kind === "highlight" ? (
          <button
            key={a.id}
            type="button"
            data-annotation={a.id}
            data-kind="highlight"
            aria-label={t("highlightAria", { page: a.page })}
            title={a.text || undefined}
            onClick={(e) => {
              e.stopPropagation();
              setPending(null);
              setSelectedId(a.id === selectedId ? null : a.id);
            }}
            className="absolute rounded-[2px] outline-none ring-offset-0 focus-visible:ring-2 focus-visible:ring-white/80"
            style={{
              left: `${a.x * 100}%`,
              top: `${a.y * 100}%`,
              width: `${a.w * 100}%`,
              height: `${a.h * 100}%`,
              background: ANNOTATION_SWATCH[a.color].fill,
              mixBlendMode: "multiply",
              // while another tool is active the highlight must not swallow the press that starts a new drag
              pointerEvents: activeTool === "select" ? "auto" : "none",
              boxShadow: a.id === selectedId ? "0 0 0 2px rgba(255,255,255,0.9)" : undefined,
            }}
          />
        ) : (
          <button
            key={a.id}
            type="button"
            data-annotation={a.id}
            data-kind="note"
            aria-label={t("noteAria", { page: a.page })}
            onClick={(e) => {
              e.stopPropagation();
              setPending(null);
              setSelectedId(a.id === selectedId ? null : a.id);
            }}
            className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-black/30 text-black shadow outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, background: ANNOTATION_SWATCH[a.color].solid, pointerEvents: activeTool === "select" ? "auto" : "none" }}
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )
      )}

      {draft && (
        <div
          data-draft-highlight
          className="pointer-events-none absolute rounded-[2px]"
          style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%`, background: ANNOTATION_SWATCH[color].fill, outline: "1px dashed rgba(0,0,0,0.4)" }}
        />
      )}

      {selected && (
        <Popover
          x={selected.x}
          y={selected.kind === "note" ? selected.y + 0.02 : selected.y + selected.h}
          right={selected.x > 0.55}
          anchorRight={selected.kind === "note" ? selected.x : selected.x + selected.w}
        >
          <SelectedEditor
            key={selected.id}
            annotation={selected}
            readOnly={readOnly}
            onClose={() => setSelectedId(null)}
            onUpdate={onUpdate}
            onDelete={async () => {
              const ok = await onDelete(selected.id);
              if (ok) setSelectedId(null);
              else onHint?.(t("errorSave"));
            }}
          />
        </Popover>
      )}

      {pending && !readOnly && (
        <Popover x={pending.x} y={pending.y + 0.01} right={pending.x > 0.55} anchorRight={pending.x}>
          <NewNote
            onCancel={() => setPending(null)}
            onSave={async (text) => {
              const ok = await onCreate({ page, kind: "note", text, color, x: pending.x, y: pending.y, w: 0, h: 0 });
              if (ok) setPending(null);
              else onHint?.(t("errorSave"));
              return ok;
            }}
          />
        </Popover>
      )}
    </div>
  );
}

function Popover({ x, y, right, anchorRight, children }: { x: number; y: number; right: boolean; anchorRight: number; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      data-annotation-popover
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="absolute z-20 w-60 rounded-lg border border-border-gold bg-navy p-3 text-left shadow-xl"
      style={right ? { right: `${(1 - anchorRight) * 100}%`, top: `${y * 100}%` } : { left: `${x * 100}%`, top: `${y * 100}%` }}
    >
      {children}
    </div>
  );
}

function Swatches({ value, onPick }: { value: AnnotationColor; onPick: (c: AnnotationColor) => void }) {
  const t = useTranslations("resumeViewer");
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={t("colorLabel")}>
      {ANNOTATION_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={t(`colors.${c}`)}
          aria-pressed={c === value}
          onClick={() => onPick(c)}
          className="h-5 w-5 rounded-full border border-white/30"
          style={{ background: ANNOTATION_SWATCH[c].solid, boxShadow: c === value ? "0 0 0 2px #fff" : undefined }}
        />
      ))}
    </div>
  );
}

function NewNote({ onSave, onCancel }: { onSave: (text: string) => Promise<boolean>; onCancel: () => void }) {
  const t = useTranslations("resumeViewer");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <textarea
        autoFocus
        value={text}
        maxLength={MAX_NOTE_CHARS}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("notePlaceholder")}
        rows={3}
        className="w-full resize-none rounded-md border border-border-gold bg-white/[0.04] p-2 text-xs text-cream outline-none focus:border-violet"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-2.5 py-1 text-xs text-muted-cream hover:text-cream">
          {t("cancel")}
        </button>
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            const ok = await onSave(text);
            if (!ok) setBusy(false);
          }}
          className="rounded-md bg-violet px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          {t("save")}
        </button>
      </div>
    </div>
  );
}

function SelectedEditor({
  annotation,
  readOnly,
  onClose,
  onUpdate,
  onDelete,
}: {
  annotation: LayerAnnotation;
  readOnly: boolean;
  onClose: () => void;
  onUpdate: (id: string, patch: AnnotationPatch) => Promise<boolean>;
  onDelete: () => void;
}) {
  const t = useTranslations("resumeViewer");
  const [text, setText] = useState(annotation.text);
  const dirty = text.trim() !== annotation.text;

  if (readOnly) {
    return (
      <div>
        <p className="whitespace-pre-wrap text-xs leading-snug text-cream">{annotation.text || t("highlightNoText")}</p>
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-md px-2.5 py-1 text-xs text-muted-cream hover:text-cream">
            {t("cancel")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <textarea
        value={text}
        maxLength={MAX_NOTE_CHARS}
        onChange={(e) => setText(e.target.value)}
        placeholder={annotation.kind === "note" ? t("notePlaceholder") : t("addComment")}
        rows={3}
        className="w-full resize-none rounded-md border border-border-gold bg-white/[0.04] p-2 text-xs text-cream outline-none focus:border-violet"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <Swatches value={annotation.color} onPick={(c) => void onUpdate(annotation.id, { color: c })} />
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t("delete")} title={t("delete")} onClick={onDelete} className="rounded-md p-1 text-red-300 hover:bg-red-500/10">
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={!dirty || (annotation.kind === "note" && !text.trim())}
            onClick={async () => {
              if (await onUpdate(annotation.id, { text })) onClose();
            }}
            className="rounded-md bg-violet px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
