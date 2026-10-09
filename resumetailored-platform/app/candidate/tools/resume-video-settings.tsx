"use client";

import { useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Upload, Trash2, Loader2, Palette, ImageIcon } from "lucide-react";
import { Label } from "../components/ui";
import { cn } from "@/lib/utils";
import { HEADSHOT_MAX_DIMENSION, MAX_HEADSHOT_DATA_URL_CHARS, cleanHexColor, type VideoSettings } from "@/lib/video-settings";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
// The renderer draws the headshot 168px wide in a 1080×1920 frame and keeps it fully inside; the preview
// clamps the same way so what you place is what is rendered.
const HALF_W = 84 / 1080;
const HALF_H = 84 / 1920;
const DEFAULT_PREVIEW_BG = "#1b1f4b";

/** Decode a chosen jpg/png, centre-crop to a square and downsize to a small JPEG data URL. */
export async function prepareHeadshot(file: File): Promise<{ dataUrl?: string; error?: "type" | "size" | "read" }> {
  if (!/^image\/(jpeg|png)$/.test(file.type)) return { error: "type" };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "size" };
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    }).finally(() => URL.revokeObjectURL(url));
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) return { error: "read" };
    const out = Math.min(HEADSHOT_MAX_DIMENSION, side);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { error: "read" };
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out, out);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    if (!dataUrl.startsWith("data:image/jpeg") || dataUrl.length > MAX_HEADSHOT_DATA_URL_CHARS) return { error: "size" };
    return { dataUrl };
  } catch {
    return { error: "read" };
  }
}

/**
 * The "Video settings" block, shown with the script controls BEFORE anything is generated: voice (the
 * picker is passed in), background colour (full colour picker + hex), headshot upload, and a small 9:16
 * preview where the headshot is dragged into place.
 */
export function VideoSettingsPanel({
  settings,
  onChange,
  voicePicker,
  saveFailed,
}: {
  settings: VideoSettings;
  onChange: (patch: Partial<VideoSettings>) => void;
  voicePicker: ReactNode;
  saveFailed: boolean;
}) {
  const t = useTranslations("candidateTools.resumeVideo");
  const fileRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [hex, setHex] = useState<string | null>(null); // the text field while it is being typed

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setNote(null);
    const r = await prepareHeadshot(file);
    setBusy(false);
    if (r.dataUrl) onChange({ headshot: r.dataUrl });
    else setNote(r.error === "type" ? t("errorHeadshotType") : r.error === "size" ? t("errorHeadshotSize") : t("errorHeadshotRead"));
  }

  const clampX = (x: number) => Math.min(1 - HALF_W, Math.max(HALF_W, x));
  const clampY = (y: number) => Math.min(1 - HALF_H, Math.max(HALF_H, y));
  const dragRef = useRef(false);
  function moveTo(clientX: number, clientY: number) {
    const r = frameRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return;
    onChange({ headshotX: clampX((clientX - r.left) / r.width), headshotY: clampY((clientY - r.top) / r.height) });
  }
  function onKey(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.02;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    onChange({ headshotX: clampX(settings.headshotX + m[0]), headshotY: clampY(settings.headshotY + m[1]) });
  }

  const bg = settings.backgroundColor;
  const previewBg = bg || DEFAULT_PREVIEW_BG;

  return (
    <div className="space-y-3.5 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
      <div>
        <div className="flex items-center gap-2">
          <Palette className="h-3.5 w-3.5 text-violet" />
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-cream">{t("videoSettings")}</h4>
        </div>
        <p className="mt-1 text-[11px] text-white/45">{t("videoSettingsHint")}</p>
      </div>

      <div>
        <Label>{t("voice")}</Label>
        {voicePicker}
      </div>

      <div>
        <Label>{t("backgroundColor")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            aria-label={t("backgroundColor")}
            value={bg || DEFAULT_PREVIEW_BG}
            onChange={(e) => { setHex(null); onChange({ backgroundColor: cleanHexColor(e.target.value) }); }}
            className="h-9 w-12 cursor-pointer rounded-lg border border-border-gold bg-transparent p-0.5"
          />
          <input
            type="text"
            inputMode="text"
            aria-label={t("backgroundHex")}
            placeholder={t("backgroundDefault")}
            maxLength={7}
            value={hex ?? bg ?? ""}
            onChange={(e) => {
              const v = e.target.value.trim();
              setHex(v);
              const ok = cleanHexColor(v.startsWith("#") ? v : `#${v}`);
              if (ok) onChange({ backgroundColor: ok });
            }}
            onBlur={() => setHex(null)}
            className="w-28 rounded-xl border border-border-gold bg-white/5 px-3 py-2 font-mono text-sm text-cream outline-none focus:border-violet focus:ring-1 focus:ring-violet"
          />
          {bg && (
            <button type="button" onClick={() => { setHex(null); onChange({ backgroundColor: null }); }} className="text-xs text-white/60 underline-offset-2 hover:text-cream hover:underline">
              {t("resetColor")}
            </button>
          )}
        </div>
      </div>

      <div>
        <Label>{t("headshot")}</Label>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden onChange={onPick} />
        <div className="flex flex-wrap items-start gap-4">
          {/* 9:16 preview: drag the headshot to place it. */}
          <div
            ref={frameRef}
            className="relative w-[132px] shrink-0 overflow-hidden rounded-lg border border-white/15 shadow-inner"
            style={{ aspectRatio: "9 / 16", background: previewBg }}
          >
            <div className="absolute inset-x-4 top-[44%] space-y-1.5 opacity-60">
              <div className="mx-auto h-1.5 w-2/3 rounded bg-white/70" />
              <div className="mx-auto h-1 w-1/2 rounded bg-white/40" />
            </div>
            {settings.headshot && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={settings.headshot}
                alt=""
                role="slider"
                tabIndex={0}
                aria-label={t("headshotPlacement")}
                aria-valuenow={Math.round(settings.headshotX * 100)}
                aria-valuetext={`${Math.round(settings.headshotX * 100)}%, ${Math.round(settings.headshotY * 100)}%`}
                draggable={false}
                onKeyDown={onKey}
                onPointerDown={(e) => { dragRef.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
                onPointerMove={(e) => { if (dragRef.current) moveTo(e.clientX, e.clientY); }}
                onPointerUp={() => { dragRef.current = false; }}
                onPointerCancel={() => { dragRef.current = false; }}
                className="absolute aspect-square cursor-grab touch-none rounded-full border-2 border-violet object-cover active:cursor-grabbing"
                style={{ width: "15.6%", left: `${settings.headshotX * 100}%`, top: `${settings.headshotY * 100}%`, transform: "translate(-50%, -50%)" }}
              />
            )}
            {!settings.headshot && <ImageIcon className="absolute left-1/2 top-[14%] h-5 w-5 -translate-x-1/2 text-white/30" />}
          </div>
          <div className="min-w-0 flex-1 basis-44 space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-2.5 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-white/8 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {settings.headshot ? t("headshotReplace") : t("headshotUpload")}
              </button>
              {settings.headshot && (
                <button type="button" onClick={() => onChange({ headshot: null })} className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-2.5 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-white/8">
                  <Trash2 className="h-3.5 w-3.5" /> {t("headshotRemove")}
                </button>
              )}
            </div>
            <p className="text-[11px] text-white/45">{t("headshotHint")}</p>
            {settings.headshot && (
              <>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-cream">
                  <input type="checkbox" checked={settings.everySlide} onChange={(e) => onChange({ everySlide: e.target.checked })} className={cn("h-4 w-4 rounded accent-violet")} />
                  {t("headshotEverySlide")}
                </label>
                {!settings.everySlide && <p className="text-[11px] text-white/45">{t("headshotTitleOnly")}</p>}
              </>
            )}
            {note && <p className="text-xs text-red-300">{note}</p>}
          </div>
        </div>
      </div>
      {saveFailed && <p className="text-[11px] text-amber-300/80">{t("settingsNotSaved")}</p>}
    </div>
  );
}
