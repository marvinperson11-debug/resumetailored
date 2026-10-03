"use client";

import { useEffect, useState } from "react";
import { useExportAuth } from "../components/use-export-auth";
import { useTranslations } from "next-intl";
import { PenTool, LayoutGrid, FileText, Download, FileType } from "lucide-react";
import { cn } from "@/lib/utils";
import { findTemplate, type CoverMeta } from "@/lib/resume-templates";
import { downloadPdf, downloadTxt } from "@/lib/pdf";
import { buildCoverLetterPayload } from "@/lib/cover-letter-prompt";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, TextInput, PrimaryButton, SecondaryButton } from "../components/ui";
import { useTools } from "../components/tools-context";
import { TemplatePicker } from "./template-picker";
import { DocPreview } from "./doc-preview";

export function CoverLetterTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const t = useTranslations("candidateTools.coverLetter");
  const { pendingCoverTpl, clearPendingCoverTpl } = useTools();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [highlights, setHighlights] = useState("");
  const [jobText, setJobText] = useState("");
  // Honor a template pre-selected from the Templates gallery, else default Formal.
  const [tplId, setTplId] = useState(pendingCoverTpl || "c1");

  // Consume the pending template exactly once on open.
  useEffect(() => {
    if (pendingCoverTpl) clearPendingCoverTpl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"content" | "templates">("content");

  const tpl = findTemplate("cover", tplId);
  const exportAuth = useExportAuth([tplId]);
  const coverMeta: CoverMeta = { name, company, role };

  async function generate() {
    if (!jobText.trim() && !company.trim()) {
      setError(t("errorMissingDetails"));
      return;
    }
    setLoading(true);
    setError(null);
    // Compose the candidate's background block from the structured fields.
    const { resume: background, jobPosting } = buildCoverLetterPayload({ name, contact, highlights, company, role, jobText });
    try {
      const res = await fetch("/api/cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: background, jobPosting, templateId: tplId }),
      });
      const data = (await res.json().catch(() => ({}))) as { result?: string; error?: string; message?: string };
      if (!res.ok || !data.result) {
        throw new Error(data.message || data.error || t("errorGenerationFailed"));
      }
      setResult(data.result.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-white/45 sm:block">
        {t("templateLabel")} <span className="text-cream">{tpl.name}</span>
      </span>
      {result && (
        <>
          <SecondaryButton onClick={() => (exportAuth.allowed ? downloadTxt(result, "cover-letter", !exportAuth.watermark) : setError(exportAuth.message))}>
            <FileType className="h-4 w-4" /> TXT
          </SecondaryButton>
          <SecondaryButton
            onClick={() => (exportAuth.allowed ? downloadPdf({ text: result, tplId, mode: "cover_letter", title: t("title"), isPro: !exportAuth.watermark, coverMeta }) : setError(exportAuth.message))}
          >
            <Download className="h-4 w-4" /> PDF
          </SecondaryButton>
        </>
      )}
      <PrimaryButton onClick={generate} loading={loading}>
        <PenTool className="h-4 w-4" /> {result ? t("regenerate") : t("generateLetter")}
      </PrimaryButton>
    </>
  );

  return (
    <ToolModal title={t("title")} icon={PenTool} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col border-b border-border-gold lg:border-b-0 lg:border-r">
          <div className="flex gap-1 border-b border-border-gold p-2">
            <SegTab active={view === "content"} onClick={() => setView("content")} icon={FileText} label={t("tabContent")} />
            <SegTab active={view === "templates"} onClick={() => setView("templates")} icon={LayoutGrid} label={t("tabTemplates")} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {view === "content" ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t("yourName")}</Label>
                    <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} />
                  </div>
                  <div>
                    <Label>{t("contactLine")}</Label>
                    <TextInput value={contact} onChange={(e) => setContact(e.target.value)} placeholder="email · phone · city" />
                  </div>
                  <div>
                    <Label>{t("company")}</Label>
                    <TextInput value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Stripe" />
                  </div>
                  <div>
                    <Label>{t("role")}</Label>
                    <TextInput value={role} onChange={(e) => setRole(e.target.value)} placeholder={t("rolePlaceholder")} />
                  </div>
                </div>
                <div>
                  <Label>{t("yourHighlights")}</Label>
                  <TextArea
                    rows={5}
                    value={highlights}
                    onChange={(e) => setHighlights(e.target.value)}
                    placeholder={t("highlightsPlaceholder")}
                  />
                </div>
                <div>
                  <Label>{t("jobPosting")}</Label>
                  <TextArea rows={6} value={jobText} onChange={(e) => setJobText(e.target.value)} placeholder={t("jobPostingPlaceholder")} />
                </div>
                {error && (
                  <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
                )}
              </div>
            ) : (
              <TemplatePicker cat="cover" selectedId={tplId} onSelect={setTplId} isPro={isPro} />
            )}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto bg-navy/40 p-4">
          <DocPreview
            text={result}
            tplId={tplId}
            mode="cover_letter"
            coverMeta={coverMeta}
            placeholder={t("previewPlaceholder", { action: t("generateLetter") })}
          />
        </div>
      </div>
    </ToolModal>
  );
}

function SegTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileText;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
        active ? "bg-violet/20 text-white" : "text-muted-cream hover:bg-white/5"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
