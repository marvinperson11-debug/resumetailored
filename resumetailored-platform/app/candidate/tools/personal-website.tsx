"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Sparkles, Loader2, Download, ImagePlus, X, ExternalLink, Copy, Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, TextInput, Select, PrimaryButton, SecondaryButton, UpgradeNote } from "../components/ui";
import { generateSiteHtml, SITE_TEMPLATES, SITE_THEMES, type SiteData, type SiteSection } from "@/lib/site-templates";
import type { ResumeDraft } from "@/lib/draft-types";

async function toPhoto(file: File): Promise<string> {
  const raw = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });
  try {
    const img = document.createElement("img");
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = raw; });
    const max = 512, scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    const ctx = c.getContext("2d"); if (!ctx) return raw;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch { return raw; }
}

interface EditSection extends SiteSection { include: boolean }

export function PersonalWebsiteTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const router = useRouter();
  const [resumes, setResumes] = useState<ResumeDraft[]>([]);
  const [resumeText, setResumeText] = useState("");
  const [name, setName] = useState("");
  const [headline, setHeadline] = useState("");
  const [about, setAbout] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [photo, setPhoto] = useState("");
  const [template, setTemplate] = useState("portfolio");
  const [theme, setTheme] = useState(SITE_THEMES[0].id);
  const [sections, setSections] = useState<EditSection[]>([]);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/resumes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { drafts?: ResumeDraft[] }) => setResumes(d.drafts || []))
      .catch(() => {});
  }, []);

  const data: SiteData = useMemo(
    () => ({ name: name || "Your Name", headline, about, email, location, photo, template, theme, sections: sections.filter((s) => s.include).map((s) => ({ title: s.title, items: s.items })) }),
    [name, headline, about, email, location, photo, template, theme, sections]
  );
  const html = useMemo(() => generateSiteHtml(data), [data]);

  async function genCopy() {
    if (resumeText.trim().length < 40) {
      setError("Paste your resume or pick a saved one first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/personal-website/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: resumeText }),
      });
      const d = (await res.json().catch(() => ({}))) as { copy?: { name: string; headline: string; about: string; sections: SiteSection[] }; error?: string; message?: string };
      if (!res.ok || !d.copy) throw new Error(d.message || d.error || "Could not generate copy.");
      setName(d.copy.name || name);
      setHeadline(d.copy.headline || "");
      setAbout(d.copy.about || "");
      setSections((d.copy.sections || []).map((s) => ({ ...s, include: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setError("Image too large (max 8MB)."); return; }
    setPhoto(await toPhoto(file));
  }

  function downloadHtml() {
    const blob = new Blob([html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(name || "site").replace(/[^a-z0-9-_ ]/gi, "_")}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function publish() {
    if (!isPro) { router.push("/candidate?upgrade=pro"); return; }
    if (!name.trim()) { setError("Add your name before publishing."); return; }
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch("/api/personal-website/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
      const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
      if (res.status === 402) { router.push("/candidate?upgrade=pro"); return; }
      if (!res.ok || !d.url) throw new Error(d.message || d.error || "Publish failed.");
      setPublishedUrl(d.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPublishing(false);
    }
  }

  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-white/45 sm:block">{isPro ? "Pro · publish + download" : "Free · preview + download"}</span>
      <SecondaryButton onClick={downloadHtml}><Download className="h-4 w-4" /> Download HTML</SecondaryButton>
      <PrimaryButton onClick={publish} loading={publishing} className={cn(!isPro && "bg-gold text-navy hover:shadow-none")}>
        {isPro ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />} Publish website
      </PrimaryButton>
    </>
  );

  return (
    <ToolModal title="Personal Website" icon={Globe} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-2">
        {/* Left: form */}
        <div className="min-h-0 space-y-4 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap gap-2">
            {resumes.length > 0 && (
              <Select
                className="flex-1"
                value=""
                onChange={(e) => { const d = resumes.find((r) => r.id === e.target.value); if (d) setResumeText(d.content.result || d.content.resumeText || ""); }}
              >
                <option value="">Use a saved resume…</option>
                {resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </Select>
            )}
          </div>
          <div>
            <Label>Resume text</Label>
            <TextArea rows={5} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="Paste your resume, then Generate copy…" />
            <button type="button" onClick={genCopy} disabled={loading} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-violet px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Generate copy from resume
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Template</Label>
              <Select value={template} onChange={(e) => setTemplate(e.target.value)}>{SITE_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>
            </div>
            <div>
              <Label>Theme</Label>
              <Select value={theme} onChange={(e) => setTheme(e.target.value)}>{SITE_THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>
            </div>
          </div>

          <div>
            <Label>Photo</Label>
            <input ref={photoRef} type="file" accept="image/*" hidden onChange={onPhoto} />
            {photo ? (
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo} alt="" className="h-11 w-11 rounded-full object-cover" />
                <button type="button" onClick={() => setPhoto("")} className="inline-flex items-center gap-1 rounded-lg border border-border-gold px-2.5 py-2 text-xs text-cream hover:bg-white/8"><X className="h-3.5 w-3.5" /> Remove</button>
              </div>
            ) : (
              <button type="button" onClick={() => photoRef.current?.click()} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-gold px-3 py-2.5 text-xs text-muted-cream hover:bg-white/5"><ImagePlus className="h-4 w-4" /> Upload photo</button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Name</Label><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Mitchell" /></div>
            <div><Label>Headline</Label><TextInput value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Product Manager · Growth" /></div>
            <div><Label>Email</Label><TextInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" /></div>
            <div><Label>Location</Label><TextInput value={location} onChange={(e) => setLocation(e.target.value)} placeholder="New York" /></div>
          </div>
          <div><Label>About</Label><TextArea rows={4} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="A few sentences about you…" /></div>

          {sections.length > 0 && (
            <div className="space-y-3">
              <Label>Sections</Label>
              {sections.map((s, i) => (
                <div key={i} className="rounded-xl border border-border-gold bg-white/5 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <input type="checkbox" checked={s.include} onChange={(e) => setSections((cur) => cur.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} className="h-4 w-4 accent-violet" />
                    <input value={s.title} onChange={(e) => setSections((cur) => cur.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className="flex-1 bg-transparent text-sm font-semibold text-cream outline-none" />
                  </div>
                  <TextArea rows={3} value={s.items.join("\n")} onChange={(e) => setSections((cur) => cur.map((x, j) => (j === i ? { ...x, items: e.target.value.split("\n").filter(Boolean) } : x)))} className="text-xs" />
                </div>
              ))}
            </div>
          )}

          {!isPro && <UpgradeNote>Pro publishes your site to a public link. Free can preview + download the HTML.</UpgradeNote>}
          {publishedUrl && (
            <div className="rounded-xl border border-teal/40 bg-teal/10 p-3">
              <p className="text-xs font-semibold text-teal">Published!</p>
              <div className="mt-1.5 flex items-center gap-2">
                <input readOnly value={publishedUrl} className="flex-1 rounded-lg border border-border-gold bg-white/5 px-2 py-1.5 text-xs text-cream" />
                <button type="button" onClick={() => { navigator.clipboard?.writeText(publishedUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="rounded-lg border border-border-gold px-2 py-1.5 text-cream hover:bg-white/8">{copied ? <Check className="h-3.5 w-3.5 text-teal" /> : <Copy className="h-3.5 w-3.5" />}</button>
                <a href={publishedUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border-gold px-2 py-1.5 text-cream hover:bg-white/8"><ExternalLink className="h-3.5 w-3.5" /></a>
              </div>
            </div>
          )}
          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        </div>

        {/* Right: live preview */}
        <div className="min-h-0 overflow-hidden bg-navy/40 p-4">
          <div className="h-full min-h-[360px] overflow-hidden rounded-xl border border-border-gold bg-white">
            <iframe title="Website preview" srcDoc={html} className="h-full w-full" style={{ minHeight: 360 }} />
          </div>
        </div>
      </div>
    </ToolModal>
  );
}
