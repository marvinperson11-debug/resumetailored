"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  LayoutGrid,
  FileText,
  Download,
  FileType,
  Link2,
  ImagePlus,
  X,
  Check,
  Target,
  Loader2,
  Upload,
  Pencil,
  Eye,
  RotateCcw,
  FileDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { findTemplate, BODY_FONTS, SIG_FONTS, FONT_MAP, SIG_FONT_MAP } from "@/lib/resume-templates";
import { downloadPdf, downloadTxt, downloadDocx } from "@/lib/pdf";
import { analyzeSkillGap } from "@/lib/skills-gap";
import { emptyDraftContent, type ResumeDraftContent } from "@/lib/draft-types";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, TextInput, Select, PrimaryButton, SecondaryButton } from "../components/ui";
import { useTools } from "../components/tools-context";
import { TemplatePicker } from "./template-picker";
import { DocPreview } from "./doc-preview";

type View = "content" | "gap" | "templates";

/** Downscale an uploaded photo to a small square-ish JPEG data URL. */
async function fileToPhotoDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  try {
    const img = document.createElement("img");
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = raw;
    });
    const max = 400;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return raw;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return raw;
  }
}

function deriveTitle(jobText: string): string {
  const firstLine = jobText.split("\n").map((l) => l.trim()).find(Boolean);
  if (firstLine) return firstLine.slice(0, 80);
  const d = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `Resume — ${d}`;
}

export function ResumeBuilderTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const { pendingDraft, pendingDraftId, clearPendingDraft } = useTools();

  // Stable draft id for this editing session (reused across autosaves).
  const draftIdRef = useRef<string>(pendingDraftId || (globalThis.crypto?.randomUUID?.() ?? `d_${Date.now()}`));

  const seed = pendingDraft ?? emptyDraftContent();
  const [resumeText, setResumeText] = useState(seed.resumeText);
  const [jobText, setJobText] = useState(seed.jobText);
  const [tplId, setTplId] = useState(seed.tplId || "r1");
  const [result, setResult] = useState(seed.result);
  const [originalResult, setOriginalResult] = useState(seed.result); // the last AI output, for "Reset to AI version"
  const [editing, setEditing] = useState(false);
  const [docxBusy, setDocxBusy] = useState(false);
  const [photo, setPhoto] = useState(seed.photo || "");
  const [signature, setSignature] = useState(seed.signature || "");
  const [docFont, setDocFont] = useState(seed.docFont || "");
  const [sigFont, setSigFont] = useState(seed.sigFont || "dancing");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("content");

  const [jobUrl, setJobUrl] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const resumeFileRef = useRef<HTMLInputElement>(null);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);

  // Consume the pending draft exactly once on open.
  useEffect(() => {
    if (pendingDraft) clearPendingDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tpl = findTemplate("resume", tplId);
  const gap = useMemo(() => analyzeSkillGap(resumeText, jobText), [resumeText, jobText]);
  // Resolve the selected fonts to real CSS stacks so the live sample updates the
  // instant a dropdown changes (no build required).
  const bodyCss = (docFont && FONT_MAP[docFont]) || (tpl.serif ? "Georgia,'Times New Roman',serif" : "Arial,sans-serif");
  const sigCss = (sigFont && SIG_FONT_MAP[sigFont]) || "'Dancing Script','Segoe Script',cursive";

  // Latest content snapshot for autosave (avoids stale-closure in the interval).
  const contentRef = useRef<ResumeDraftContent>(seed);
  const currentContent = (): ResumeDraftContent => ({
    resumeText,
    jobText,
    result,
    tplId,
    docFont,
    sigFont,
    signature,
    photo,
  });
  contentRef.current = currentContent();
  const lastSavedRef = useRef<string>("");

  const persist = useCallback(async (content: ResumeDraftContent) => {
    if (!content.resumeText.trim() && !content.result.trim()) return; // nothing worth saving
    const key = JSON.stringify(content);
    if (key === lastSavedRef.current) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/resumes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draftIdRef.current, title: deriveTitle(content.jobText), content }),
      });
      if (res.ok) {
        lastSavedRef.current = key;
        setSaveState("saved");
      } else {
        setSaveState("idle");
      }
    } catch {
      setSaveState("idle");
    }
  }, []);

  // Autosave every 30s (FIX 7 #6).
  useEffect(() => {
    const t = setInterval(() => void persist(contentRef.current), 30000);
    return () => clearInterval(t);
  }, [persist]);

  // Flush a save when the modal closes so work is never lost on exit.
  useEffect(() => {
    return () => {
      void persist(contentRef.current);
    };
  }, [persist]);

  async function onResumeFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setUploadNote("That file is too large (max 10MB).");
      return;
    }
    setResumeUploading(true);
    setUploadNote(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract-text", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !data.text) throw new Error(data.error || "Could not read that file.");
      setResumeText(data.text);
      setUploadNote(`Imported “${file.name}”. Review the text below before building.`);
    } catch (err) {
      setUploadNote(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setResumeUploading(false);
    }
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("That image is too large (max 10MB).");
      return;
    }
    setPhoto(await fileToPhotoDataUrl(file));
  }

  async function importUrl() {
    if (!jobUrl.trim()) return;
    setUrlLoading(true);
    setUrlError(null);
    try {
      const res = await fetch("/api/fetch-job-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: jobUrl.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !data.text) throw new Error(data.error || "Could not import that URL.");
      setJobText(data.text);
      setJobUrl("");
    } catch (e) {
      setUrlError(e instanceof Error ? e.message : "Could not import that URL.");
    } finally {
      setUrlLoading(false);
    }
  }

  async function build() {
    if (!resumeText.trim() || !jobText.trim()) {
      setError("Paste both your resume and the job posting.");
      setView("content");
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
        throw new Error(data.message || data.error || "Build failed. Please try again.");
      }
      const built = data.result.trim();
      setResult(built);
      setOriginalResult(built); // baseline for "Reset to AI version"
      setEditing(false);
      // Save on build (FIX 7 #6).
      void persist({ ...currentContent(), result: built });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function exportDocx() {
    setDocxBusy(true);
    setError(null);
    const err = await downloadDocx({ text: result, tplId, mode: "resume", title: "Resume", photo, signature, docFont });
    if (err) setError(err);
    setDocxBusy(false);
  }

  const footer = (
    <>
      <span className="mr-auto hidden items-center gap-3 text-xs text-white/45 sm:flex">
        <span>
          Template: <span className="text-cream">{tpl.name}</span>
        </span>
        {saveState === "saving" && (
          <span className="flex items-center gap-1 text-white/40">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </span>
        )}
        {saveState === "saved" && (
          <span className="flex items-center gap-1 text-teal">
            <Check className="h-3 w-3" /> Saved
          </span>
        )}
      </span>
      {result && (
        <>
          <SecondaryButton onClick={() => downloadTxt(result, "resume", isPro)}>
            <FileType className="h-4 w-4" /> TXT
          </SecondaryButton>
          <SecondaryButton
            onClick={() =>
              downloadPdf({ text: result, tplId, mode: "resume", title: "Resume", isPro, docFont, photo, signature, sigFont })
            }
          >
            <Download className="h-4 w-4" /> PDF
          </SecondaryButton>
          <SecondaryButton onClick={exportDocx} disabled={docxBusy}>
            {docxBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} .docx
          </SecondaryButton>
        </>
      )}
      <PrimaryButton onClick={build} loading={loading}>
        <Sparkles className="h-4 w-4" /> {result ? "Rebuild" : "Build My Resume"}
      </PrimaryButton>
    </>
  );

  return (
    <ToolModal title="AI Resume Builder" icon={Sparkles} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-2">
        {/* Left: form / gap / templates */}
        <div className="flex min-h-0 flex-col border-b border-border-gold lg:border-b-0 lg:border-r">
          <div className="flex gap-1 border-b border-border-gold p-2">
            <SegTab active={view === "content"} onClick={() => setView("content")} icon={FileText} label="Content" />
            <SegTab active={view === "gap"} onClick={() => setView("gap")} icon={Target} label="Skills gap" />
            <SegTab active={view === "templates"} onClick={() => setView("templates")} icon={LayoutGrid} label="Templates" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {view === "content" && (
              <div className="space-y-4">
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <Label>Your current resume</Label>
                    <input
                      ref={resumeFileRef}
                      type="file"
                      accept=".txt,.pdf,.docx,.doc,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      hidden
                      onChange={onResumeFile}
                    />
                    <button
                      type="button"
                      onClick={() => resumeFileRef.current?.click()}
                      disabled={resumeUploading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-2.5 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-white/8 disabled:opacity-50"
                    >
                      {resumeUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      Upload file
                    </button>
                  </div>
                  <TextArea
                    rows={7}
                    value={resumeText}
                    onChange={(e) => setResumeText(e.target.value)}
                    placeholder="Upload a .pdf, .docx, or .txt above — or paste your resume text here…"
                  />
                  {uploadNote && <p className="mt-1.5 text-xs text-white/55">{uploadNote}</p>}
                </div>

                <div>
                  <Label>Import job posting from URL</Label>
                  <div className="flex gap-2">
                    <TextInput
                      value={jobUrl}
                      onChange={(e) => setJobUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && importUrl()}
                      placeholder="https://…  (LinkedIn, Indeed, Greenhouse, …)"
                    />
                    <SecondaryButton onClick={importUrl} disabled={urlLoading || !jobUrl.trim()} className="shrink-0">
                      {urlLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Import
                    </SecondaryButton>
                  </div>
                  {urlError && <p className="mt-1.5 text-xs text-red-300">{urlError}</p>}
                </div>

                <div>
                  <Label>Job posting</Label>
                  <TextArea
                    rows={7}
                    value={jobText}
                    onChange={(e) => setJobText(e.target.value)}
                    placeholder="Paste the full job description, or import it from a URL above…"
                  />
                </div>

                {/* Photo + signature + fonts */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Photo</Label>
                    <input ref={photoInputRef} type="file" accept="image/*" hidden onChange={onPhoto} />
                    {photo ? (
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo} alt="" className="h-11 w-11 rounded-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setPhoto("")}
                          className="inline-flex items-center gap-1 rounded-lg border border-border-gold px-2.5 py-2 text-xs text-cream hover:bg-white/8"
                        >
                          <X className="h-3.5 w-3.5" /> Remove
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => photoInputRef.current?.click()}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-gold px-3 py-2.5 text-xs text-muted-cream hover:bg-white/5"
                      >
                        <ImagePlus className="h-4 w-4" /> Upload photo
                      </button>
                    )}
                  </div>
                  <div>
                    <Label>Signature</Label>
                    <TextInput value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="Your name" />
                  </div>
                  <div>
                    <Label>Body font</Label>
                    <Select value={docFont} onChange={(e) => setDocFont(e.target.value)}>
                      <option value="">Template default</option>
                      {BODY_FONTS.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label>Signature font</Label>
                    <Select value={sigFont} onChange={(e) => setSigFont(e.target.value)}>
                      {SIG_FONTS.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                {/* Live font sample — updates instantly as you change either
                    dropdown, without needing to build first. */}
                <div className="rounded-xl border border-border-gold bg-white/5 p-3">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-cream">Live font preview</div>
                  <div className="text-sm leading-relaxed text-cream" style={{ fontFamily: bodyCss }}>
                    The quick brown fox jumps — body font sample
                  </div>
                  <div className="mt-1 text-3xl leading-tight text-cream" style={{ fontFamily: sigCss }}>
                    {signature.trim() || "Your signature"}
                  </div>
                </div>

                {error && (
                  <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
                )}
              </div>
            )}

            {view === "gap" && <SkillsGap gap={gap} hasJob={!!jobText.trim()} />}

            {view === "templates" && <TemplatePicker cat="resume" selectedId={tplId} onSelect={setTplId} isPro={isPro} />}
          </div>
        </div>

        {/* Right: live preview + inline editor */}
        <div className="flex min-h-0 flex-col bg-navy/40">
          {result && (
            <div className="flex items-center justify-between gap-2 border-b border-border-gold px-4 py-2">
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-2.5 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-white/8"
              >
                {editing ? <Eye className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                {editing ? "Preview" : "Edit text"}
              </button>
              {result !== originalResult && originalResult && (
                <button
                  type="button"
                  onClick={() => {
                    setResult(originalResult);
                    setEditing(false);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/60 transition-colors hover:text-gold"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset to AI version
                </button>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {editing && result ? (
              <textarea
                value={result}
                onChange={(e) => setResult(e.target.value)}
                spellCheck
                className="h-full min-h-[360px] w-full resize-none rounded-xl border border-violet/50 bg-white/95 p-4 font-mono text-[13px] leading-relaxed text-navy outline-none focus:border-violet focus:ring-1 focus:ring-violet"
              />
            ) : (
              <DocPreview
                text={result}
                tplId={tplId}
                mode="resume"
                docFont={docFont}
                photo={photo}
                signature={signature}
                sigFont={sigFont}
                placeholder="Paste your resume and a job posting, then tap “Build My Resume” to see it in this template."
              />
            )}
          </div>

          {/* FIX 4: download disclaimer — subtle, below the preview and above
              the download buttons in the footer. */}
          <p className="border-t border-border-gold px-4 py-2.5 text-[11px] leading-snug text-white/40">
            {editing
              ? "Editing the text — your changes flow into the template, the preview, and every download."
              : "PDF and Word downloads may look slightly different from the on-screen preview due to browser rendering vs. document engine differences. For best results, review your download before sending."}
          </p>
        </div>
      </div>
    </ToolModal>
  );
}

function SkillsGap({ gap, hasJob }: { gap: { present: string[]; missing: string[] }; hasJob: boolean }) {
  if (!hasJob) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed border-border-gold p-6 text-center text-sm text-white/45">
        Paste or import a job posting to see which of its keywords your resume already covers.
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <p className="text-xs text-white/55">
        Keywords from the job posting, checked against your resume. Weave the missing ones in where they truthfully apply
        before you build.
      </p>
      <ChipRow title="In your resume" tone="present" items={gap.present} empty="No overlap yet — start from the missing list." />
      <ChipRow title="Missing" tone="missing" items={gap.missing} empty="Nice — your resume covers the top keywords." />
    </div>
  );
}

function ChipRow({
  title,
  tone,
  items,
  empty,
}: {
  title: string;
  tone: "present" | "missing";
  items: string[];
  empty: string;
}) {
  const present = tone === "present";
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">
        {title} <span className="text-white/40">({items.length})</span>
      </h4>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((kw) => (
            <span
              key={kw}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs",
                present ? "bg-teal/15 text-teal" : "bg-red-500/12 text-red-300"
              )}
            >
              {present ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              {kw}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-white/40">{empty}</p>
      )}
    </div>
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
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-colors",
        active ? "bg-violet/20 text-white" : "text-muted-cream hover:bg-white/5"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
