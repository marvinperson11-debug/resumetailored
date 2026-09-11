"use client";

import { useEffect, useState } from "react";
import { PenTool, LayoutGrid, FileText, Download, FileType } from "lucide-react";
import { cn } from "@/lib/utils";
import { findTemplate, type CoverMeta } from "@/lib/resume-templates";
import { downloadPdf, downloadTxt } from "@/lib/pdf";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, TextInput, PrimaryButton, SecondaryButton } from "../components/ui";
import { useTools } from "../components/tools-context";
import { TemplatePicker } from "./template-picker";
import { DocPreview } from "./doc-preview";

export function CoverLetterTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
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
  const coverMeta: CoverMeta = { name, company, role };

  async function generate() {
    if (!jobText.trim() && !company.trim()) {
      setError("Add the job details (paste the posting, or at least the company and role).");
      return;
    }
    setLoading(true);
    setError(null);
    // Compose the candidate's background block from the structured fields.
    const background = [
      name && `Name: ${name}`,
      contact && `Contact: ${contact}`,
      highlights && `Highlights / background:\n${highlights}`,
    ]
      .filter(Boolean)
      .join("\n");
    const jobPosting = [company && `Company: ${company}`, role && `Role: ${role}`, jobText && `\nJob posting:\n${jobText}`]
      .filter(Boolean)
      .join("\n");
    try {
      const res = await fetch("/api/cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: background, jobPosting }),
      });
      const data = (await res.json().catch(() => ({}))) as { result?: string; error?: string; message?: string };
      if (!res.ok || !data.result) {
        throw new Error(data.message || data.error || "Generation failed. Please try again.");
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
          <SecondaryButton onClick={() => downloadTxt(result, "cover-letter", isPro)}>
            <FileType className="h-4 w-4" /> TXT
          </SecondaryButton>
          <SecondaryButton
            onClick={() => downloadPdf({ text: result, tplId, mode: "cover_letter", title: "Cover Letter", isPro, coverMeta })}
          >
            <Download className="h-4 w-4" /> PDF
          </SecondaryButton>
        </>
      )}
      <PrimaryButton onClick={generate} loading={loading}>
        <PenTool className="h-4 w-4" /> {result ? "Regenerate" : "Generate Letter"}
      </PrimaryButton>
    </>
  );

  return (
    <ToolModal title="Cover Letter" icon={PenTool} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col border-b border-border-gold lg:border-b-0 lg:border-r">
          <div className="flex gap-1 border-b border-border-gold p-2">
            <SegTab active={view === "content"} onClick={() => setView("content")} icon={FileText} label="Content" />
            <SegTab active={view === "templates"} onClick={() => setView("templates")} icon={LayoutGrid} label="Templates" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {view === "content" ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Your name</Label>
                    <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Mitchell" />
                  </div>
                  <div>
                    <Label>Contact line</Label>
                    <TextInput value={contact} onChange={(e) => setContact(e.target.value)} placeholder="email · phone · city" />
                  </div>
                  <div>
                    <Label>Company</Label>
                    <TextInput value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Stripe" />
                  </div>
                  <div>
                    <Label>Role</Label>
                    <TextInput value={role} onChange={(e) => setRole(e.target.value)} placeholder="Product Manager" />
                  </div>
                </div>
                <div>
                  <Label>Your highlights</Label>
                  <TextArea
                    rows={5}
                    value={highlights}
                    onChange={(e) => setHighlights(e.target.value)}
                    placeholder="A few achievements or strengths to draw from…"
                  />
                </div>
                <div>
                  <Label>Job posting (optional but recommended)</Label>
                  <TextArea rows={6} value={jobText} onChange={(e) => setJobText(e.target.value)} placeholder="Paste the job description…" />
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
            placeholder="Fill in the job details and tap “Generate Letter” to see your cover letter in this template."
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
