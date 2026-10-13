"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { useTranslations } from "next-intl";
import { Maximize2, Minimize2 } from "lucide-react";
import { demoResumeAnnotations, demoResumeUrl } from "@/lib/employer-demo";
import type { AnnotationInput, AnnotationPatch, ResumeAnnotation } from "@/lib/resume-annotations";
import type { LayerAnnotation } from "./annotation-layer";
import type { PdfViewerProps } from "./pdf-viewer";

/**
 * The candidate's resume PDF, in the portal. Two sources, one viewer:
 *
 *   live   a real applicant — GET /api/employer/candidates/:id/resume proves the applicant is the caller's, returns a
 *          60-second signed URL into the private bucket plus the team's annotations; add / edit / delete go to
 *          /api/employer/candidates/:id/annotations
 *   demo   a sample candidate (negative id) — the checked-in fixture PDF and fixture annotations. NO network
 *          call, read-only: a signed-out visitor can look but not annotate, and nothing they do is sent anywhere
 *
 * This file is small on purpose. It is itself loaded with next/dynamic by its two callers, and the PDF.js
 * viewer (./pdf-viewer) is a second dynamic import() inside it that only runs once there is a PDF to show — so a
 * candidate with no PDF costs a single small fetch, and nothing else ever downloads PDF.js.
 *
 * If the viewer cannot load or render, the same PDF is shown in an <iframe> (the browser's own viewer), with a
 * notice that highlights and notes are unavailable. A recruiter can always read the resume.
 */
export type ResumeSource = { mode: "live"; applicantId: number } | { mode: "demo"; candidateId: number };

type Phase = "loading" | "none" | "ready" | "fallback" | "error";
interface LiveResponse {
  file: { id: string; filename: string } | null;
  url?: string;
  annotations?: ResumeAnnotation[];
}

export default function ResumeSection({ source, title }: { source: ResumeSource; title?: string }) {
  const t = useTranslations("resumeViewer");
  const demo = source.mode === "demo";
  const key = demo ? `demo:${source.candidateId}` : `live:${source.applicantId}`;
  const [phase, setPhase] = useState<Phase>("loading");
  const [url, setUrl] = useState<string | null>(null);
  const [live, setLive] = useState<ResumeAnnotation[]>([]);
  const [Viewer, setViewer] = useState<ComponentType<PdfViewerProps> | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const base = source.mode === "live" ? `/api/employer/candidates/${source.applicantId}` : "";

  // 1. Where is the PDF?
  const locate = useCallback(async (): Promise<{ url: string; annotations: ResumeAnnotation[] } | "none" | "error"> => {
    if (source.mode === "demo") {
      const u = demoResumeUrl(source.candidateId);
      return u ? { url: u, annotations: [] } : "none";
    }
    try {
      const res = await fetch(`${base}/resume`, { cache: "no-store" });
      if (res.status === 403 || res.status === 404) return "none"; // feature off, not yours, or no file: show nothing
      if (!res.ok) return "error";
      const d = (await res.json()) as LiveResponse;
      if (!d.file || !d.url) return "none";
      return { url: d.url, annotations: d.annotations ?? [] };
    } catch {
      return "error";
    }
  }, [source, base]);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setViewer(null);
    setNotice(null);
    (async () => {
      const found = await locate();
      if (cancelled || !alive.current) return;
      if (found === "none") return setPhase("none");
      if (found === "error") return setPhase("error");
      setUrl(found.url);
      setLive(found.annotations);
      setPhase("ready");
      // 2. Only now fetch the heavy chunk.
      try {
        const mod = await import("./pdf-viewer");
        if (!cancelled && alive.current) setViewer(() => mod.default);
      } catch {
        if (!cancelled && alive.current) setPhase("fallback");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const onFail = useCallback(
    async () => {
      if (!alive.current) return;
      // The signed URL may be nearly spent by now — get a fresh one for the fallback frame.
      const found = await locate();
      if (!alive.current) return;
      if (found !== "none" && found !== "error") setUrl(found.url);
      setPhase("fallback");
    },
    [locate]
  );

  // ── annotations ──
  const demoAnns: LayerAnnotation[] = demo
    ? demoResumeAnnotations(source.candidateId).map((a) => ({ id: a.id, kind: a.kind, page: a.page, x: a.x, y: a.y, w: a.w, h: a.h, color: a.color, text: t(`demo.${a.textKey}`) }))
    : [];
  const annotations: LayerAnnotation[] = demo ? demoAnns : live;

  const fail = (code?: string) => {
    setNotice(code === "limit" ? t("errorLimit") : t("errorSave"));
    return false;
  };
  const onCreate = async (input: AnnotationInput) => {
    if (demo) return false;
    try {
      const res = await fetch(`${base}/annotations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const d = (await res.json().catch(() => ({}))) as { annotation?: ResumeAnnotation; error?: string };
      if (!res.ok || !d.annotation) return fail(d.error);
      setLive((l) => [...l, d.annotation!]);
      setNotice(null);
      return true;
    } catch {
      return fail();
    }
  };
  const onUpdate = async (id: string, patch: AnnotationPatch) => {
    if (demo) return false;
    try {
      const res = await fetch(`${base}/annotations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const d = (await res.json().catch(() => ({}))) as { annotation?: ResumeAnnotation };
      if (!res.ok || !d.annotation) return fail();
      setLive((l) => l.map((a) => (a.id === id ? d.annotation! : a)));
      setNotice(null);
      return true;
    } catch {
      return fail();
    }
  };
  const onDelete = async (id: string) => {
    if (demo) return false;
    try {
      const res = await fetch(`${base}/annotations/${id}`, { method: "DELETE" });
      if (!res.ok) return fail();
      setLive((l) => l.filter((a) => a.id !== id));
      setNotice(null);
      return true;
    } catch {
      return fail();
    }
  };

  if (phase === "none") return null;
  const heading = title || t("section");

  return (
    <section data-resume-section={demo ? "demo" : "live"} className={expanded ? "fixed inset-0 z-[70] flex flex-col gap-3 overflow-y-auto bg-navy p-4 sm:p-6" : undefined}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-cream">{heading}</h3>
        {phase === "ready" && Viewer && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? t("collapse") : t("expand")}
            title={expanded ? t("collapse") : t("expand")}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-cream hover:bg-white/[0.08] hover:text-cream"
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />} {expanded ? t("collapse") : t("expand")}
          </button>
        )}
      </div>

      {phase === "loading" && <p className="text-xs text-white/45">{t("loading")}</p>}
      {phase === "error" && <p role="alert" className="text-xs text-red-300">{t("errorLoad")}</p>}

      {phase === "ready" && url && !Viewer && <p className="text-xs text-white/45">{t("loading")}</p>}
      {phase === "ready" && url && Viewer && (
        <Viewer url={url} annotations={annotations} readOnly={demo} onCreate={onCreate} onUpdate={onUpdate} onDelete={onDelete} onFail={onFail} />
      )}

      {phase === "fallback" && url && (
        <div data-resume-fallback>
          <p role="status" className="mb-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
            {t("fallbackNotice")}
          </p>
          <iframe title={t("iframeTitle")} src={url} className="h-[70vh] w-full rounded-xl border border-border-gold bg-white" />
          <button
            type="button"
            onClick={() => {
              setViewer(null);
              setPhase("loading");
              void (async () => {
                const found = await locate();
                if (!alive.current) return;
                if (found === "none" || found === "error") return setPhase(found === "none" ? "none" : "error");
                setUrl(found.url);
                setLive(found.annotations);
                setPhase("ready");
                try {
                  const mod = await import("./pdf-viewer");
                  if (alive.current) setViewer(() => mod.default);
                } catch {
                  if (alive.current) setPhase("fallback");
                }
              })();
            }}
            className="mt-2 text-xs font-semibold text-violet hover:underline"
          >
            {t("retry")}
          </button>
        </div>
      )}

      {phase === "ready" && Viewer && (
        <div className="mt-2 space-y-1">
          {notice && <p role="alert" className="text-xs text-red-300">{notice}</p>}
          <p className="text-[11px] text-white/45">{demo ? t("demoReadOnly") : t("private")}</p>
          <p className="text-[11px] text-white/35">{t("annotations", { count: annotations.length })}</p>
        </div>
      )}
    </section>
  );
}
