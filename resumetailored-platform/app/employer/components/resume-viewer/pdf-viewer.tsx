"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Highlighter, MessageSquarePlus, MousePointer2, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/types/src/display/api";
// The LEGACY build: it carries the polyfills (Promise.withResolvers, Array.prototype.at, …) that Safari < 17.4 and
// older Android WebViews lack, and it is the build the CI fidelity gate runs, so what is tested is what is shipped.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { ANNOTATION_COLORS, ANNOTATION_SWATCH, type AnnotationColor, type AnnotationInput, type AnnotationPatch } from "@/lib/resume-annotations";
import { AnnotationLayer, type LayerAnnotation, type Tool } from "./annotation-layer";
import { PDFJS_ASSET_BASE, pdfjsDocOptions, pdfjsWorkerSrc } from "./pdfjs-config";

/**
 * The PDF.js viewer. THIS FILE IS THE HEAVY CHUNK: it is only ever reached through a dynamic import() in
 * resume-section.tsx, so pdfjs-dist (~0.4 MB gzipped plus its worker) lives in its own lazy chunk and the main
 * bundle, and every other employer page, is untouched — scripts/check-bundle-size.cjs asserts that in CI.
 *
 * It renders each page to a <canvas> and lays our own AnnotationLayer over it. Anything that goes wrong here
 * (the worker won't start, the file is corrupt, a page won't paint) calls `onFail`, and the caller drops to the
 * browser's own PDF viewer in an <iframe> so the recruiter can still read the resume.
 */
export interface PdfViewerProps {
  url: string;
  annotations: LayerAnnotation[];
  readOnly: boolean;
  onCreate: (input: AnnotationInput) => Promise<boolean>;
  onUpdate: (id: string, patch: AnnotationPatch) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onFail: (reason: string) => void;
}

const ZOOM_STEPS = [0.6, 0.8, 1, 1.25, 1.5, 2];

export default function PdfViewer({ url, annotations, readOnly, onCreate, onUpdate, onDelete, onFail }: PdfViewerProps) {
  const t = useTranslations("resumeViewer");
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState<AnnotationColor>("yellow");
  const [zoom, setZoom] = useState(1);
  const [hint, setHint] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const failed = useRef(false);

  const fail = useCallback(
    (reason: string) => {
      if (failed.current) return;
      failed.current = true;
      onFail(reason);
    },
    [onFail]
  );

  // Load the document.
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    try {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerSrc(pdfjs.version);
      task = pdfjs.getDocument({ url, ...pdfjsDocOptions({ base: PDFJS_ASSET_BASE }), withCredentials: false });
      task.promise.then(
        (d) => {
          if (cancelled) return void d.destroy();
          setDoc(d);
        },
        (e: unknown) => !cancelled && fail(`load: ${e instanceof Error ? e.message : String(e)}`)
      );
    } catch (e) {
      fail(`init: ${e instanceof Error ? e.message : String(e)}`);
    }
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url, fail]);

  // Track the available width so a page always fits its container.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const pageWidth = Math.max(240, Math.floor((width || 600) * zoom));
  const pct = Math.round(zoom * 100);
  const stepZoom = (dir: 1 | -1) => {
    const i = ZOOM_STEPS.findIndex((z) => z >= zoom - 1e-6);
    setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))]);
  };

  const toolBtn = (id: Tool, label: string, icon: React.ReactNode) => (
    <button
      key={id}
      type="button"
      aria-pressed={tool === id}
      onClick={() => {
        setTool(id);
        setHint(id === "highlight" ? t("hintHighlight") : id === "note" ? t("hintNote") : null);
      }}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        tool === id ? "bg-violet text-white" : "border border-border-gold bg-white/[0.03] text-muted-cream hover:bg-white/[0.08]"
      }`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div data-pdf-viewer className="flex flex-col gap-2">
      <div role="toolbar" aria-label={t("toolbar")} className="flex flex-wrap items-center gap-2">
        {!readOnly && (
          <>
            {toolBtn("select", t("toolSelect"), <MousePointer2 className="h-3.5 w-3.5" />)}
            {toolBtn("highlight", t("toolHighlight"), <Highlighter className="h-3.5 w-3.5" />)}
            {toolBtn("note", t("toolNote"), <MessageSquarePlus className="h-3.5 w-3.5" />)}
            <div className="flex items-center gap-1.5" role="group" aria-label={t("colorLabel")}>
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={t(`colors.${c}`)}
                  aria-pressed={c === color}
                  onClick={() => setColor(c)}
                  className="h-5 w-5 rounded-full border border-white/30"
                  style={{ background: ANNOTATION_SWATCH[c].solid, boxShadow: c === color ? "0 0 0 2px #fff" : undefined }}
                />
              ))}
            </div>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-label={t("zoomOut")} onClick={() => stepZoom(-1)} className="rounded-md p-1.5 text-muted-cream hover:bg-white/[0.08]">
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-xs text-muted-cream">{t("zoom", { percent: pct })}</span>
          <button type="button" aria-label={t("zoomIn")} onClick={() => stepZoom(1)} className="rounded-md p-1.5 text-muted-cream hover:bg-white/[0.08]">
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>
      {hint && (
        <p role="status" className="text-[11px] text-white/55">
          {hint}
        </p>
      )}

      <div ref={box} className="max-h-[70vh] overflow-auto rounded-xl border border-border-gold bg-black/30 p-2" data-viewer-scroll>
        {!doc && <div className="py-16 text-center text-xs text-white/45">{t("loading")}</div>}
        {doc &&
          Array.from({ length: doc.numPages }, (_, i) => i + 1).map((n) => (
            <PageView
              key={n}
              doc={doc}
              pageNumber={n}
              cssWidth={pageWidth}
              annotations={annotations.filter((a) => a.page === n)}
              tool={tool}
              color={color}
              readOnly={readOnly}
              onCreate={onCreate}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onHint={setHint}
              onFail={fail}
            />
          ))}
      </div>
    </div>
  );
}

function PageView({
  doc,
  pageNumber,
  cssWidth,
  annotations,
  tool,
  color,
  readOnly,
  onCreate,
  onUpdate,
  onDelete,
  onHint,
  onFail,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  cssWidth: number;
  annotations: LayerAnnotation[];
  tool: Tool;
  color: AnnotationColor;
  readOnly: boolean;
  onCreate: PdfViewerProps["onCreate"];
  onUpdate: PdfViewerProps["onUpdate"];
  onDelete: PdfViewerProps["onDelete"];
  onHint: (m: string | null) => void;
  onFail: (reason: string) => void;
}) {
  const t = useTranslations("resumeViewer");
  const canvas = useRef<HTMLCanvasElement>(null);
  const [aspect, setAspect] = useState(1.294); // US Letter until the real page says otherwise

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        setAspect(base.height / base.width);
        const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
        const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
        const el = canvas.current;
        const ctx = el?.getContext("2d");
        if (!el || !ctx) return;
        el.width = Math.floor(viewport.width);
        el.height = Math.floor(viewport.height);
        task = page.render({ canvasContext: ctx, viewport });
        await task.promise;
      } catch (e) {
        if (cancelled || (e as { name?: string })?.name === "RenderingCancelledException") return;
        onFail(`page ${pageNumber} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, cssWidth, onFail]);

  return (
    <div className="mx-auto mb-3 last:mb-0" style={{ width: cssWidth }}>
      <div className="relative select-none bg-white shadow-md" style={{ width: cssWidth, height: Math.round(cssWidth * aspect) }} data-page={pageNumber}>
        <canvas ref={canvas} role="img" aria-label={t("pageLabel", { n: pageNumber })} className="block" style={{ width: "100%", height: "100%" }} />
        <AnnotationLayer page={pageNumber} annotations={annotations} tool={tool} color={color} readOnly={readOnly} onCreate={onCreate} onUpdate={onUpdate} onDelete={onDelete} onHint={onHint} />
      </div>
    </div>
  );
}
