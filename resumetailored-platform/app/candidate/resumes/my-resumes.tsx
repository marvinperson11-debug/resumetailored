"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/format";
import { FileText, Download, Trash2, Pencil, Plus, Loader2, RefreshCw } from "lucide-react";
import { useTools } from "../components/tools-context";
import { downloadPdf } from "@/lib/pdf";
import { isFreeTemplateId } from "@/lib/template-gate";
import type { ResumeDraft } from "@/lib/draft-types";

/**
 * "My Resumes" — the version-history page (FIX 8). Lists every saved resume from
 * Supabase (newest first), and lets the user reopen it in the AI Resume Builder,
 * download its PDF, or delete it.
 */
export function MyResumes() {
  const t = useTranslations("candidateTools.myResumes");
  const locale = useLocale();
  const { openResume, isPro } = useTools();
  const [drafts, setDrafts] = useState<ResumeDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/resumes", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { drafts?: ResumeDraft[]; error?: string };
      if (!res.ok) throw new Error(data.error || t("loadError"));
      setDrafts(data.drafts || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("genericError"));
      setDrafts([]);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await fetch(`/api/resumes/${encodeURIComponent(id)}`, { method: "DELETE" });
      setDrafts((cur) => (cur ? cur.filter((d) => d.id !== id) : cur));
    } finally {
      setBusyId(null);
    }
  };

  const fmt = (iso: string) => {
    try {
      return formatDateTime(iso, locale, iso);
    } catch {
      return iso;
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-medium text-white sm:text-3xl">{t("title")}</h1>
          <p className="mt-1 text-sm text-white/55">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-3 py-2 text-xs font-medium text-cream transition-colors hover:bg-white/8"
          >
            <RefreshCw className="h-3.5 w-3.5" /> {t("refresh")}
          </button>
          <button
            type="button"
            onClick={() => openResume()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet px-3.5 py-2 text-xs font-semibold text-white transition-all hover:-translate-y-0.5"
          >
            <Plus className="h-3.5 w-3.5" /> {t("buildNew")}
          </button>
        </div>
      </header>

      {drafts === null ? (
        <div className="flex items-center justify-center py-20 text-white/50">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : drafts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border-gold bg-white/5 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet/15">
            <FileText className="h-6 w-6 text-violet" />
          </div>
          <div>
            <p className="font-medium text-cream">{t("emptyTitle")}</p>
            <p className="mt-1 text-sm text-white/55">
              {error ? error : t("emptyBody")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openResume()}
            className="inline-flex items-center gap-2 rounded-xl bg-violet px-5 py-2.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
          >
            <Plus className="h-4 w-4" /> {t("buildMyResume")}
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {drafts.map((d) => (
            <li key={d.id} className="glass flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet/15">
                  <FileText className="h-5 w-5 text-violet" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{d.title || t("untitled")}</p>
                  <p className="text-xs text-white/45">{t("updated", { date: fmt(d.updatedAt) })}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => openResume(d.content, d.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet/90 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet"
                >
                  <Pencil className="h-3.5 w-3.5" /> {t("reopen")}
                </button>
                <button
                  type="button"
                  disabled={!d.content?.result}
                  onClick={() =>
                    downloadPdf({
                      text: d.content.result,
                      // Non-Pro accounts fall back to the free Classic template for a saved Pro-template draft.
                      tplId: isPro || isFreeTemplateId(d.content.tplId) ? d.content.tplId || "r1" : "r1",
                      mode: "resume",
                      title: d.title || t("pdfTitle"),
                      isPro,
                      docFont: d.content.docFont,
                      photo: d.content.photo,
                      signature: d.content.signature,
                      sigFont: d.content.sigFont,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-3 py-2 text-xs font-medium text-cream transition-colors hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-40"
                  title={d.content?.result ? t("downloadPdf") : t("buildFirst")}
                >
                  <Download className="h-3.5 w-3.5" /> {t("pdf")}
                </button>
                <button
                  type="button"
                  onClick={() => remove(d.id)}
                  disabled={busyId === d.id}
                  aria-label={t("deleteAria")}
                  className="inline-flex items-center justify-center rounded-lg border border-border-gold px-2.5 py-2 text-white/60 transition-colors hover:border-red-500/50 hover:text-red-300 disabled:opacity-40"
                >
                  {busyId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
