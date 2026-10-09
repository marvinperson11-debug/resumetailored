"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Film, Download, FileText, Pencil, Trash2, Loader2, Play } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { VIDEO_VOICES } from "@/lib/video-ai";
import type { SavedVideoDetail } from "@/lib/saved-videos";
import { useTools } from "../components/tools-context";

export interface SavedVideoSummary {
  id: string;
  title: string;
  scriptSource: "ai" | "written";
  toWhom: string;
  voice: string;
  sizeBytes: number;
  createdAt: string;
}

const base = (id: string) => `/api/resume-video/saved/${encodeURIComponent(id)}`;

/**
 * A saved Resume Video, shown in the same list as the resumes the user has built. Watch plays it in place;
 * Download video / Download script fetch the owner-checked files; Edit reopens the creator pre-filled exactly
 * as it was made (a new run is saved as a NEW video — this one is never overwritten); Delete removes it.
 */
export function SavedVideoCard({ video, onDeleted }: { video: SavedVideoSummary; onDeleted: (id: string) => void }) {
  const t = useTranslations("candidateTools.myResumes");
  const locale = useLocale();
  const { openVideoEdit } = useTools();
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState<"edit" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const title = video.toWhom ? t("videoTitleFor", { name: video.toWhom }) : t("videoTitle");
  const voice = VIDEO_VOICES.find((v) => v.key === video.voice)?.label.split("—")[0].trim();
  const date = (() => {
    try {
      return formatDateTime(video.createdAt, locale, video.createdAt);
    } catch {
      return video.createdAt;
    }
  })();

  async function edit() {
    setBusy("edit");
    setError(null);
    try {
      const res = await fetch(base(video.id), { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { video?: SavedVideoDetail };
      if (!res.ok || !data.video) throw new Error("load");
      openVideoEdit(data.video);
    } catch {
      setError(t("videoOpenError"));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(base(video.id), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error("delete");
      onDeleted(video.id);
    } catch {
      setError(t("genericError"));
      setBusy(null);
    }
  }

  const btn = "inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-3 py-2 text-xs font-medium text-cream transition-colors hover:bg-white/8";
  return (
    <li className="glass space-y-3 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet/15">
            <Film className="h-5 w-5 text-violet" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-white">
              {title} <span className="ml-1.5 rounded-full bg-violet/20 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-violet">{t("videoBadge")}</span>
            </p>
            <p className="text-xs text-white/45">
              {t("created", { date })} · {video.scriptSource === "written" ? t("videoSourceWritten") : t("videoSourceAi")}
              {voice ? ` · ${voice}` : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" onClick={() => setWatching((w) => !w)} aria-expanded={watching} className="inline-flex items-center gap-1.5 rounded-lg bg-violet/90 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet">
            <Play className="h-3.5 w-3.5" /> {watching ? t("hideVideo") : t("watch")}
          </button>
          <a href={`${base(video.id)}/video?download=1`} className={btn}>
            <Download className="h-3.5 w-3.5" /> {t("downloadVideo")}
          </a>
          <a href={`${base(video.id)}/script`} className={btn}>
            <FileText className="h-3.5 w-3.5" /> {t("downloadScript")}
          </a>
          <button type="button" onClick={edit} disabled={busy !== null} className={`${btn} disabled:opacity-50`}>
            {busy === "edit" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />} {t("edit")}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy !== null}
            aria-label={t("deleteVideoAria")}
            className="inline-flex items-center justify-center rounded-lg border border-border-gold px-2.5 py-2 text-white/60 transition-colors hover:border-red-500/50 hover:text-red-300 disabled:opacity-40"
          >
            {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {watching && <video src={`${base(video.id)}/video`} controls autoPlay className="mx-auto max-h-[70vh] w-full max-w-sm rounded-lg border border-white/10 bg-black" />}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </li>
  );
}
