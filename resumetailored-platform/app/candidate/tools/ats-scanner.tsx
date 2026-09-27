"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ScanLine, Check, X, Lightbulb, Upload, Loader2 } from "lucide-react";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, PrimaryButton } from "../components/ui";
import type { AtsResult } from "@/lib/ai";

const VERDICT_TONE: Record<string, string> = {
  "Strong Match": "text-teal",
  "Good Match": "text-teal",
  "Fair Match": "text-gold",
  "Weak Match": "text-red-400",
};

/** The AI backend (lib/ai.ts) always returns one of these 4 literal English
 *  strings — mapped here to a translated display label, keyed off the raw
 *  (untranslated) value so matching VERDICT_TONE above still works. */
const VERDICT_KEY: Record<string, string> = {
  "Strong Match": "strongMatch",
  "Good Match": "goodMatch",
  "Fair Match": "fairMatch",
  "Weak Match": "weakMatch",
};

export function AtsScannerTool({ onClose }: { onClose: () => void }) {
  const t = useTranslations("candidateTools.atsScanner");
  const [resumeText, setResumeText] = useState("");
  const [jobText, setJobText] = useState("");
  const [result, setResult] = useState<AtsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setUploadNote(t("errorTooLarge"));
      return;
    }
    setUploading(true);
    setUploadNote(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract-text", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !data.text) throw new Error(data.error || t("errorCouldNotRead"));
      setResumeText(data.text);
      setUploadNote(t("importedFile", { name: file.name }));
    } catch (err) {
      setUploadNote(err instanceof Error ? err.message : t("errorCouldNotRead"));
    } finally {
      setUploading(false);
    }
  }

  async function scan() {
    if (!resumeText.trim() || !jobText.trim()) {
      setError(t("errorMissingBoth"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ats-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: resumeText, jobPosting: jobText }),
      });
      const data = (await res.json().catch(() => ({}))) as AtsResult & { error?: string; message?: string };
      if (!res.ok || typeof data.score !== "number") {
        throw new Error(data.message || data.error || t("errorAnalysisFailed"));
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-white/45 sm:block">{t("freeUnlimited")}</span>
      <PrimaryButton onClick={scan} loading={loading}>
        <ScanLine className="h-4 w-4" /> {result ? t("scanAgain") : t("scanResume")}
      </PrimaryButton>
    </>
  );

  return (
    <ToolModal title={t("title")} icon={ScanLine} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-2">
        {/* Left: form */}
        <div className="min-h-0 space-y-4 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Label>{t("yourResume")}</Label>
              <input ref={fileRef} type="file" accept=".txt,.pdf,.docx,.doc,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={onFile} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-2.5 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-white/8 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {t("uploadResume")}
              </button>
            </div>
            <TextArea rows={10} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder={t("resumePlaceholder")} />
            {uploadNote && <p className="mt-1.5 text-xs text-white/55">{uploadNote}</p>}
          </div>
          <div>
            <Label>{t("jobDescription")}</Label>
            <TextArea rows={10} value={jobText} onChange={(e) => setJobText(e.target.value)} placeholder={t("jobDescriptionPlaceholder")} />
          </div>
          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        </div>

        {/* Right: results */}
        <div className="min-h-0 overflow-y-auto bg-navy/40 p-5">
          {result ? (
            <div className="space-y-6">
              <ScoreGauge score={result.score} verdict={result.verdict} />
              <KeywordList title={t("matchedKeywords")} tone="match" items={result.matched} />
              <KeywordList title={t("missingKeywords")} tone="miss" items={result.missing} />
              {result.suggestions?.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-cream">
                    <Lightbulb className="h-3.5 w-3.5 text-gold" /> {t("suggestions")}
                  </h4>
                  <ul className="space-y-2">
                    {result.suggestions.map((s, i) => (
                      <li key={i} className="rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-white/80">
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.fallback && (
                <p className="text-xs text-white/40">{t("offlineEstimate")}</p>
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-border-gold p-8 text-center text-sm text-white/45">
              {t("resultsPlaceholder")}
            </div>
          )}
        </div>
      </div>
    </ToolModal>
  );
}

function ScoreGauge({ score, verdict }: { score: number; verdict: string }) {
  const t = useTranslations("candidateTools.atsScanner");
  const tone = VERDICT_TONE[verdict] || "text-cream";
  const verdictLabel = t(`verdict.${VERDICT_KEY[verdict] || "strongMatch"}` as "verdict.strongMatch");
  const deg = Math.max(0, Math.min(100, score)) * 3.6;
  const color = score >= 60 ? "#14B8A6" : score >= 40 ? "#F59E0B" : "#f87171";
  return (
    <div className="flex items-center gap-5">
      <div
        className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full"
        style={{ background: `conic-gradient(${color} ${deg}deg, rgba(255,255,255,0.1) 0deg)` }}
      >
        <div className="flex h-[76px] w-[76px] flex-col items-center justify-center rounded-full bg-navy">
          <span className="text-2xl font-bold text-white">{score}</span>
          <span className="text-[9px] uppercase tracking-wide text-white/50">/ 100</span>
        </div>
      </div>
      <div>
        <div className={`font-serif text-2xl font-medium ${tone}`}>{verdictLabel}</div>
        <p className="mt-1 text-sm text-white/55">{t("keywordMatchNote")}</p>
      </div>
    </div>
  );
}

function KeywordList({ title, tone, items }: { title: string; tone: "match" | "miss"; items: string[] }) {
  if (!items?.length) return null;
  const isMatch = tone === "match";
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">{title}</h4>
      <div className="flex flex-wrap gap-1.5">
        {items.map((kw, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
              isMatch ? "bg-teal/15 text-teal" : "bg-red-500/12 text-red-300"
            }`}
          >
            {isMatch ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            {kw}
          </span>
        ))}
      </div>
    </div>
  );
}
