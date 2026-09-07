"use client";

import { useState } from "react";
import { Sparkles, LayoutGrid, FileText, Download, FileType } from "lucide-react";
import { cn } from "@/lib/utils";
import { findTemplate } from "@/lib/resume-templates";
import { downloadPdf, downloadTxt } from "@/lib/pdf";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, PrimaryButton, SecondaryButton } from "../components/ui";
import { TemplatePicker } from "./template-picker";
import { DocPreview } from "./doc-preview";

export function ResumeTailorTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const [resumeText, setResumeText] = useState("");
  const [jobText, setJobText] = useState("");
  const [tplId, setTplId] = useState("r1");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"content" | "templates">("content");

  const tpl = findTemplate("resume", tplId);

  async function tailor() {
    if (!resumeText.trim() || !jobText.trim()) {
      setError("Paste both your resume and the job posting.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: resumeText, jobPosting: jobText, mode: "resume" }),
      });
      const data = (await res.json().catch(() => ({}))) as { result?: string; error?: string; message?: string };
      if (!res.ok || !data.result) {
        throw new Error(data.message || data.error || "Tailoring failed. Please try again.");
      }
      setResult(data.result.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-white/45 sm:block">
        Template: <span className="text-cream">{tpl.name}</span>
      </span>
      {result && (
        <>
          <SecondaryButton onClick={() => downloadTxt(result, "tailored-resume", isPro)}>
            <FileType className="h-4 w-4" /> TXT
          </SecondaryButton>
          <SecondaryButton onClick={() => downloadPdf({ text: result, tplId, mode: "resume", title: "Tailored Resume", isPro })}>
            <Download className="h-4 w-4" /> PDF
          </SecondaryButton>
        </>
      )}
      <PrimaryButton onClick={tailor} loading={loading}>
        <Sparkles className="h-4 w-4" /> {result ? "Re-tailor" : "Tailor My Resume"}
      </PrimaryButton>
    </>
  );

  return (
    <ToolModal title="Resume Tailor" icon={Sparkles} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-2">
        {/* Left: form / templates */}
        <div className="flex min-h-0 flex-col border-b border-border-gold lg:border-b-0 lg:border-r">
          <div className="flex gap-1 border-b border-border-gold p-2">
            <SegTab active={view === "content"} onClick={() => setView("content")} icon={FileText} label="Content" />
            <SegTab active={view === "templates"} onClick={() => setView("templates")} icon={LayoutGrid} label="Templates" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {view === "content" ? (
              <div className="space-y-4">
                <div>
                  <Label>Your current resume</Label>
                  <TextArea
                    rows={9}
                    value={resumeText}
                    onChange={(e) => setResumeText(e.target.value)}
                    placeholder="Paste your existing resume text here…"
                  />
                </div>
                <div>
                  <Label>Job posting</Label>
                  <TextArea
                    rows={9}
                    value={jobText}
                    onChange={(e) => setJobText(e.target.value)}
                    placeholder="Paste the full job description you're targeting…"
                  />
                </div>
                {error && (
                  <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
                )}
              </div>
            ) : (
              <TemplatePicker cat="resume" selectedId={tplId} onSelect={setTplId} isPro={isPro} />
            )}
          </div>
        </div>

        {/* Right: live preview */}
        <div className="min-h-0 overflow-y-auto bg-navy/40 p-4">
          <DocPreview
            text={result}
            tplId={tplId}
            mode="resume"
            placeholder="Paste your resume and a job posting, then tap “Tailor My Resume” to see your tailored resume in this template."
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
