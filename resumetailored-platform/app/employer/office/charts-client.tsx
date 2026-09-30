"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Clipboard, Upload, Database, Download, FileText, Loader2, CheckCircle2 } from "lucide-react";
import { Panel, Field, Input, Picker, Btn, LockedModuleBanner, useFirstTouch, FirstTouchSnackbar } from "../components/ui";
import {
  buildChartSvg,
  parseCsvPoints,
  CHART_TYPES,
  CHART_SOURCES,
  type ChartType,
  type ChartSource,
  type ChartPoint,
} from "@/lib/office-hub";

type Mode = "paste" | "upload" | "live";

/** Render a hand-rolled SVG (built server-side-shaped, but here purely
 *  client-side) into a canvas and return a PNG data URL. No chart library —
 *  the SVG markup is our own, built from escaped, numeric-only content. */
function svgToPngDataUrl(svg: string, width: number, height: number, errors: { canvas: string; render: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error(errors.canvas));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error(errors.render));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

const SVG_W = 640;
const SVG_H = 400;

export function ChartsTab({ canCharts, canManage }: { canCharts: boolean; canManage: boolean }) {
  const t = useTranslations("employerOffice.charts");
  const ts = useTranslations("shell");
  const [mode, setMode] = useState<Mode>("live");
  const [source, setSource] = useState<ChartSource>("timesheet");
  const [csvText, setCsvText] = useState("");
  const [livePoints, setLivePoints] = useState<ChartPoint[]>([]);
  const [loadingLive, setLoadingLive] = useState(false);
  const [type, setType] = useState<ChartType>("bar");
  const [title, setTitle] = useState(t("sources.timesheet"));
  const [xLabel, setXLabel] = useState(t("employee"));
  const [yLabel, setYLabel] = useState(t("hours"));
  const [inserting, setInserting] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode !== "live" || !canCharts) return;
    setLoadingLive(true);
    setError(null);
    fetch(`/api/employer/office/chart-data?source=${source}`)
      .then((r) => r.json())
      .then((d: { points?: ChartPoint[]; error?: string }) => {
        if (d.error) setError(d.error);
        setLivePoints(d.points || []);
      })
      .catch(() => setError(t("errorLoadLiveData")))
      .finally(() => setLoadingLive(false));
  }, [mode, source, canCharts, t]);

  // Title follows the picked live source by default (until the user edits it).
  useEffect(() => {
    if (mode === "live") setTitle(t(`sources.${source}` as "sources.timesheet"));
  }, [mode, source, t]);

  const points = mode === "live" ? livePoints : parseCsvPoints(csvText);

  const svg = useMemo(
    () => buildChartSvg({ type, title, points, xLabel: type === "pie" ? undefined : xLabel, yLabel: type === "pie" ? undefined : yLabel }),
    [type, title, points, xLabel, yLabel]
  );

  const locked = !canCharts;
  const { touched, dismiss, handlers } = useFirstTouch(locked);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
  }

  async function download() {
    try {
      const url = await svgToPngDataUrl(svg, SVG_W, SVG_H, { canvas: ts("chart.canvasUnsupported"), render: ts("chart.renderFailed") });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(title || t("chartFilenameFallback")).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
      a.click();
    } catch {
      setError(t("errorRenderForDownload"));
    }
  }

  async function insertIntoDocument() {
    setInserting(true);
    setInserted(false);
    setError(null);
    try {
      const url = await svgToPngDataUrl(svg, SVG_W, SVG_H, { canvas: ts("chart.canvasUnsupported"), render: ts("chart.renderFailed") });
      const res = await fetch("/api/employer/office/chart-insert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title || t("chartTitleFallback"), pngDataUrl: url }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(d.error || t("errorInsertChart"));
        return;
      }
      setInserted(true);
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setInserting(false);
    }
  }

  return (
    <div {...handlers}>
      {locked && <LockedModuleBanner feature={t("chartsFeature")} tier="Scale" />}
      <FirstTouchSnackbar show={touched} feature={t("chartsFeature")} tier="Scale" onDismiss={dismiss} />
      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <div className="space-y-5">
        <Panel>
          <h3 className="mb-3 text-sm font-semibold text-cream">{t("dataSource")}</h3>
          <div className="mb-3 flex gap-1.5">
            {([
              { m: "live", label: t("modes.live"), icon: Database },
              { m: "paste", label: t("modes.paste"), icon: Clipboard },
              { m: "upload", label: t("modes.upload"), icon: Upload },
            ] as const).map(({ m, label, icon: Icon }) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  mode === m ? "border-violet bg-violet/15 text-violet" : "border-border-gold text-muted-cream hover:bg-white/5"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          {mode === "live" && (
            <Field label={t("source")} hint={t("sourceHint")}>
              <Picker value={source} onChange={(e) => setSource(e.target.value as ChartSource)}>
                {CHART_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sources.${s}` as "sources.timesheet")}
                  </option>
                ))}
              </Picker>
            </Field>
          )}
          {mode === "paste" && (
            <Field label={t("csv")} hint={t("csvHint")}>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                rows={6}
                placeholder={"Week 1,120\nWeek 2,145"}
                className="w-full resize-y rounded-lg border border-border-gold bg-white/5 px-3 py-2.5 font-mono text-xs text-cream placeholder:text-white/35 outline-none transition-colors focus:border-violet focus:ring-1 focus:ring-violet"
              />
            </Field>
          )}
          {mode === "upload" && (
            <Field label={t("csvFile")}>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={onFile}
                className="block w-full text-xs text-white/60 file:mr-2 file:rounded file:border-0 file:bg-violet/20 file:px-2 file:py-1 file:text-violet"
              />
              {csvText && <p className="mt-2 text-xs text-white/45">{t("rowsParsed", { n: parseCsvPoints(csvText).length })}</p>}
            </Field>
          )}
        </Panel>

        <Panel>
          <h3 className="mb-3 text-sm font-semibold text-cream">{t("chartHeading")}</h3>
          <div className="mb-3 flex gap-1.5">
            {CHART_TYPES.map((ct) => (
              <button
                key={ct}
                type="button"
                onClick={() => setType(ct)}
                className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  type === ct ? "border-violet bg-violet/15 text-violet" : "border-border-gold text-muted-cream hover:bg-white/5"
                }`}
              >
                {t(`types.${ct}` as "types.bar")}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            <Field label={t("titleLabel")}><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></Field>
            {type !== "pie" && (
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("xAxisLabel")}><Input value={xLabel} onChange={(e) => setXLabel(e.target.value)} maxLength={40} /></Field>
                <Field label={t("yAxisLabel")}><Input value={yLabel} onChange={(e) => setYLabel(e.target.value)} maxLength={40} /></Field>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div>
        <Panel className="overflow-x-auto">
          {loadingLive ? (
            <div className="flex h-[400px] items-center justify-center text-sm text-white/50">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("loadingData")}
            </div>
          ) : (
            <div className="mx-auto max-w-full" style={{ width: SVG_W }} dangerouslySetInnerHTML={{ __html: svg }} />
          )}
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-gold/50 pt-4">
            <Btn variant="ghost" onClick={download} disabled={points.length === 0}>
              <Download className="h-4 w-4" /> {t("downloadPng")}
            </Btn>
            {canManage && (
              <Btn onClick={insertIntoDocument} loading={inserting} disabled={points.length === 0}>
                <FileText className="h-4 w-4" /> {t("insertIntoDocument")}
              </Btn>
            )}
            {inserted && (
              <span className="inline-flex items-center gap-1.5 text-sm text-teal">
                <CheckCircle2 className="h-4 w-4" /> {t("savedToDocuments")}
              </span>
            )}
          </div>
        </Panel>
      </div>
      </div>
    </div>
  );
}
