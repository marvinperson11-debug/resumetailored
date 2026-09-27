"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, Upload, Download, FileText, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Panel, Field, Input, Area, Btn, TierUpgradeNote } from "../components/ui";
import { SPREADSHEET_PRESETS, type SpreadsheetGrid } from "@/lib/office-hub";

type Mode = "describe" | "upload";

/** Add/remove a column or row without mutating the grid the caller passed in
 *  — every cell input is a controlled field bound straight to this state. */
function setCell(grid: SpreadsheetGrid, r: number, c: number, value: string): SpreadsheetGrid {
  const rows = grid.rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? value : cell)) : row));
  return { ...grid, rows };
}
function setHeader(grid: SpreadsheetGrid, c: number, value: string): SpreadsheetGrid {
  return { ...grid, headers: grid.headers.map((h, i) => (i === c ? value : h)) };
}
function addRow(grid: SpreadsheetGrid): SpreadsheetGrid {
  return { ...grid, rows: [...grid.rows, grid.headers.map(() => "")] };
}
function removeRow(grid: SpreadsheetGrid, r: number): SpreadsheetGrid {
  return { ...grid, rows: grid.rows.filter((_, i) => i !== r) };
}

export function SpreadsheetTab({ canSpreadsheet, canManage }: { canSpreadsheet: boolean; canManage: boolean }) {
  const t = useTranslations("employerOffice.spreadsheet");
  const [mode, setMode] = useState<Mode>("describe");
  const [description, setDescription] = useState("");
  const [grid, setGrid] = useState<SpreadsheetGrid | null>(null);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");

  if (!canSpreadsheet) return <TierUpgradeNote feature={t("spreadsheetCreatorFeature")} />;

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setFileName(file.name);
  }

  async function generateFromDescription() {
    setGenerating(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/employer/office/spreadsheet-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const d = (await res.json().catch(() => ({}))) as { grid?: SpreadsheetGrid; error?: string };
      if (!res.ok || !d.grid) {
        setError(d.error || t("errorGenerate"));
        return;
      }
      setGrid(d.grid);
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setGenerating(false);
    }
  }

  async function generateFromUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError(t("errorChooseFile"));
      return;
    }
    setGenerating(true);
    setError(null);
    setSaved(false);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("description", description);
      const res = await fetch("/api/employer/office/spreadsheet-extract", { method: "POST", body: form });
      const d = (await res.json().catch(() => ({}))) as { grid?: SpreadsheetGrid; error?: string };
      if (!res.ok || !d.grid) {
        setError(d.error || t("errorReadFile"));
        return;
      }
      setGrid(d.grid);
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setGenerating(false);
    }
  }

  async function downloadXlsx() {
    if (!grid) return;
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch("/api/employer/office/spreadsheet-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(grid),
      });
      if (!res.ok) {
        setError(t("errorBuildXlsx"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(grid.title || t("spreadsheetFilenameFallback")).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setDownloading(false);
    }
  }

  async function saveToDocuments() {
    if (!grid) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/employer/office/spreadsheet-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(grid),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(d.error || t("errorSaveToDocuments"));
        return;
      }
      setSaved(true);
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <div className="space-y-5">
        <Panel>
          <h3 className="mb-3 text-sm font-semibold text-cream">{t("buildASpreadsheet")}</h3>
          <div className="mb-3 flex gap-1.5">
            {([
              { m: "describe", label: t("describeIt"), icon: Sparkles },
              { m: "upload", label: t("uploadSources"), icon: Upload },
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

          {mode === "describe" && (
            <>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {SPREADSHEET_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setDescription(p.prompt)}
                    className="rounded-lg border border-border-gold px-2.5 py-1 text-xs font-medium text-muted-cream transition-colors hover:bg-white/5"
                  >
                    {t(`presets.${p.key}` as "presets.payroll")}
                  </button>
                ))}
              </div>
              <Field label={t("describeWhatYouWant")}>
                <Area
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  maxLength={2000}
                  placeholder={t("describePlaceholder")}
                />
              </Field>
              <Btn className="mt-3 w-full" onClick={generateFromDescription} loading={generating} disabled={!description.trim()}>
                <Sparkles className="h-4 w-4" /> {t("generate")}
              </Btn>
            </>
          )}

          {mode === "upload" && (
            <>
              <Field label={t("uploadFileLabel")} hint={t("uploadFileHint")}>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.pdf,.docx,.doc,.txt"
                  onChange={onFile}
                  className="block w-full text-xs text-white/60 file:mr-2 file:rounded file:border-0 file:bg-violet/20 file:px-2 file:py-1 file:text-violet"
                />
                {fileName && <p className="mt-2 text-xs text-white/45">{fileName}</p>}
              </Field>
              <Field label={t("extraInstructions")} hint={t("extraInstructionsHint")}>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
              </Field>
              <Btn className="mt-3 w-full" onClick={generateFromUpload} loading={generating}>
                <Upload className="h-4 w-4" /> {t("structureIt")}
              </Btn>
            </>
          )}
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        </Panel>
      </div>

      <div>
        <Panel className="overflow-x-auto">
          {!grid ? (
            <div className="flex h-[300px] items-center justify-center text-center text-sm text-white/45">
              {t("previewEmptyState")}
            </div>
          ) : (
            <div>
              <Input
                value={grid.title}
                onChange={(e) => setGrid({ ...grid, title: e.target.value })}
                maxLength={200}
                className="mb-3 text-base font-semibold"
              />
              <div className="overflow-x-auto rounded-lg border border-border-gold">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b border-border-gold bg-white/[0.03]">
                      {grid.headers.map((h, c) => (
                        <th key={c} className="p-1">
                          <input
                            value={h}
                            onChange={(e) => setGrid(setHeader(grid, c, e.target.value))}
                            className="w-full min-w-[100px] rounded border border-transparent bg-transparent px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-cream outline-none focus:border-violet focus:bg-white/5"
                          />
                        </th>
                      ))}
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {grid.rows.map((row, r) => (
                      <tr key={r} className="border-b border-border-gold/60 last:border-0">
                        {row.map((cell, c) => (
                          <td key={c} className="p-1">
                            <input
                              value={cell}
                              onChange={(e) => setGrid(setCell(grid, r, c, e.target.value))}
                              className="w-full min-w-[100px] rounded border border-transparent bg-transparent px-2 py-1 text-cream outline-none focus:border-violet focus:bg-white/5"
                            />
                          </td>
                        ))}
                        <td className="p-1 text-right">
                          <button type="button" onClick={() => setGrid(removeRow(grid, r))} title={t("deleteRow")} className="text-white/30 hover:text-red-300">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Btn variant="ghost" className="mt-2" onClick={() => setGrid(addRow(grid))}>
                <Plus className="h-4 w-4" /> {t("addRow")}
              </Btn>

              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-gold/50 pt-4">
                <Btn variant="ghost" onClick={downloadXlsx} loading={downloading} disabled={grid.headers.length === 0}>
                  <Download className="h-4 w-4" /> {t("downloadXlsx")}
                </Btn>
                {canManage && (
                  <Btn onClick={saveToDocuments} loading={saving} disabled={grid.headers.length === 0}>
                    <FileText className="h-4 w-4" /> {t("saveToDocuments")}
                  </Btn>
                )}
                {saved && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-teal">
                    <CheckCircle2 className="h-4 w-4" /> {t("savedToDocuments")}
                  </span>
                )}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
