"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Globe, Sparkles, Loader2, Download, ImagePlus, X, ExternalLink, Copy, Check,
  Monitor, Smartphone, Film,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, TextInput, Select, PrimaryButton, SecondaryButton } from "../components/ui";
import {
  generateSiteHtml, SITE_TEMPLATES, SITE_THEMES, HEADING_FONTS, BODY_FONTS, SIZE_SCALES,
  type SiteData, type SiteSection,
} from "@/lib/site-templates";
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
interface VideoRow { id: number; title: string; videoUrl: string }

export function PersonalWebsiteTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const router = useRouter();
  const [resumes, setResumes] = useState<ResumeDraft[]>([]);
  const [resumeText, setResumeText] = useState("");
  const [name, setName] = useState("");
  const [headline, setHeadline] = useState("");
  const [about, setAbout] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [github, setGithub] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [photo, setPhoto] = useState("");
  const [template, setTemplate] = useState("portfolio");
  const [theme, setTheme] = useState(SITE_THEMES[1].id); // Violet default
  const [headingFont, setHeadingFont] = useState<"sans" | "serif" | "mono">("sans");
  const [bodyFont, setBodyFont] = useState<"sans" | "serif">("sans");
  const [sizeScale, setSizeScale] = useState<"compact" | "normal" | "spacious">("normal");
  const [sections, setSections] = useState<EditSection[]>([]);
  // Resume video integration.
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [includeVideo, setIncludeVideo] = useState(false);
  const [videoId, setVideoId] = useState<number | null>(null);
  // Preview.
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [alreadyPublished, setAlreadyPublished] = useState(false);
  const [copied, setCopied] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  // Pro-only tool. openTool blocks free users; this is a backstop for any direct
  // arrival (stale bundle / direct state) — redirect and render nothing.
  useEffect(() => {
    if (!isPro) { router.push("/candidate?upgrade=pro"); onClose(); }
  }, [isPro, router, onClose]);

  useEffect(() => {
    if (!isPro) return;
    fetch("/api/resumes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { drafts?: ResumeDraft[] }) => setResumes(d.drafts || []))
      .catch(() => {});
    fetch("/api/resume-video/list", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { videos?: VideoRow[] }) => setVideos(d.videos || []))
      .catch(() => {});
    // Prefill from an existing published site → enables "Update" mode.
    fetch("/api/personal-website/mine", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { site?: { slug: string; url: string; config?: Partial<SiteData> } | null }) => {
        if (!d.site) return;
        setAlreadyPublished(true);
        setPublishedUrl(d.site.url);
        const c = d.site.config;
        if (!c) return;
        if (c.name) setName(c.name);
        if (c.headline) setHeadline(c.headline);
        if (c.about) setAbout(c.about);
        if (c.email) setEmail(c.email);
        if (c.location) setLocation(c.location);
        if (c.photo) setPhoto(c.photo);
        if (c.template) setTemplate(c.template);
        if (c.theme) setTheme(c.theme);
        if (c.links?.linkedin) setLinkedin(c.links.linkedin);
        if (c.links?.github) setGithub(c.links.github);
        if (c.links?.portfolio) setPortfolio(c.links.portfolio);
        if (c.typography?.heading) setHeadingFont(c.typography.heading);
        if (c.typography?.body) setBodyFont(c.typography.body);
        if (c.typography?.scale) setSizeScale(c.typography.scale);
        if (c.videoUrl) setIncludeVideo(true);
        if (Array.isArray(c.sections)) setSections(c.sections.map((s) => ({ title: s.title, items: s.items, include: true })));
      })
      .catch(() => {});
  }, [isPro]);

  const selectedVideoUrl = useMemo(() => {
    if (!includeVideo) return "";
    if (videoId != null) return videos.find((v) => v.id === videoId)?.videoUrl || "";
    return videos[0]?.videoUrl || "";
  }, [includeVideo, videoId, videos]);

  const data: SiteData = useMemo(
    () => ({
      name: name || "Your Name", headline, about, email, location, photo, template, theme,
      links: { linkedin, github, portfolio },
      typography: { heading: headingFont, body: bodyFont, scale: sizeScale },
      videoUrl: selectedVideoUrl || undefined,
      sections: sections.filter((s) => s.include).map((s) => ({ title: s.title, items: s.items })),
    }),
    [name, headline, about, email, location, photo, template, theme, linkedin, github, portfolio, headingFont, bodyFont, sizeScale, selectedVideoUrl, sections]
  );
  const html = useMemo(() => generateSiteHtml(data), [data]);

  // Debounce the preview (300ms) so fast typing doesn't thrash the iframe.
  const [previewHtml, setPreviewHtml] = useState(html);
  useEffect(() => {
    const t = setTimeout(() => setPreviewHtml(html), 300);
    return () => clearTimeout(t);
  }, [html]);

  async function genCopy() {
    if (resumeText.trim().length < 40) { setError("Paste your resume or pick a saved one first."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/personal-website/copy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: resumeText }),
      });
      if (res.status === 402) { router.push("/candidate?upgrade=pro"); return; }
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
    if (!name.trim()) { setError("Add your name before publishing."); return; }
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch("/api/personal-website/publish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
      if (res.status === 402) { router.push("/candidate?upgrade=pro"); return; }
      const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
      if (!res.ok || !d.url) throw new Error(d.message || d.error || "Publish failed.");
      setPublishedUrl(d.url);
      setAlreadyPublished(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPublishing(false);
    }
  }

  const cardCn = (active: boolean) =>
    cn(
      "relative rounded-xl border p-2.5 text-left transition-all",
      active ? "border-violet shadow-[0_0_18px_rgba(139,92,246,0.45)]" : "border-border-gold hover:border-white/30"
    );

  if (!isPro) return null;

  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-white/45 sm:block">Pro · publish + download</span>
      <SecondaryButton onClick={downloadHtml}><Download className="h-4 w-4" /> Download HTML</SecondaryButton>
      <PrimaryButton onClick={publish} loading={publishing}>
        <Globe className="h-4 w-4" /> {alreadyPublished ? "Update published site" : "Publish website"}
      </PrimaryButton>
    </>
  );

  return (
    <ToolModal title="Personal Website" icon={Globe} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-[45%_55%]">
        {/* Left: form */}
        <div className="min-h-0 space-y-5 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
          {/* Template picker */}
          <div>
            <Label>Template</Label>
            <div className="grid grid-cols-2 gap-2.5">
              {SITE_TEMPLATES.map((t) => (
                <button key={t.id} type="button" onClick={() => setTemplate(t.id)} className={cardCn(template === t.id)}>
                  <TemplateThumb id={t.id} accent={theme} />
                  <div className="mt-2 text-xs font-semibold text-cream">{t.label}</div>
                  <div className="text-[10px] text-white/45">{t.desc}</div>
                  {template === t.id && <Check className="absolute right-2 top-2 h-4 w-4 rounded-full bg-violet p-0.5 text-white" />}
                </button>
              ))}
            </div>
          </div>

          {/* Color theme swatches */}
          <div>
            <Label>Color theme</Label>
            <div className="flex flex-wrap gap-2">
              {SITE_THEMES.map((t) => (
                <button
                  key={t.id} type="button" title={t.label} onClick={() => setTheme(t.id)}
                  className={cn("h-8 w-8 rounded-full border-2 transition-transform hover:scale-110", theme === t.id ? "border-white ring-2 ring-violet" : "border-white/20")}
                  style={{ background: t.id }}
                >
                  {theme === t.id && <Check className="mx-auto h-4 w-4 text-white drop-shadow" />}
                </button>
              ))}
            </div>
          </div>

          {/* Typography */}
          <div>
            <Label>Typography</Label>
            <div className="grid grid-cols-3 gap-2">
              <Select value={headingFont} onChange={(e) => setHeadingFont(e.target.value as typeof headingFont)} aria-label="Heading font">
                {HEADING_FONTS.map((f) => <option key={f.id} value={f.id}>H: {f.label}</option>)}
              </Select>
              <Select value={bodyFont} onChange={(e) => setBodyFont(e.target.value as typeof bodyFont)} aria-label="Body font">
                {BODY_FONTS.map((f) => <option key={f.id} value={f.id}>B: {f.label}</option>)}
              </Select>
              <Select value={sizeScale} onChange={(e) => setSizeScale(e.target.value as typeof sizeScale)} aria-label="Size scale">
                {SIZE_SCALES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </Select>
            </div>
          </div>

          {/* Photo */}
          <div>
            <Label>Photo (optional)</Label>
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

          {/* Resume video integration */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={includeVideo} onChange={(e) => setIncludeVideo(e.target.checked)} className="h-4 w-4 accent-violet" />
              <Film className="h-4 w-4 text-violet" />
              <span className="text-sm font-medium text-cream">Include my Resume Video</span>
            </label>
            {includeVideo && (
              videos.length ? (
                <Select className="mt-2" value={videoId ?? videos[0]?.id ?? ""} onChange={(e) => setVideoId(Number(e.target.value))}>
                  {videos.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
                </Select>
              ) : (
                <p className="mt-2 text-[11px] text-white/50">No saved resume videos yet — generate one in the Resume Video tool first.</p>
              )
            )}
          </div>

          {/* Personal info */}
          <div>
            <Label>Personal info</Label>
            <div className="grid grid-cols-2 gap-2.5">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
              <TextInput value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Headline / title" />
              <TextInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
              <TextInput value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" />
              <TextInput value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="LinkedIn URL (optional)" />
              <TextInput value={github} onChange={(e) => setGithub(e.target.value)} placeholder="GitHub URL (optional)" />
              <TextInput className="col-span-2" value={portfolio} onChange={(e) => setPortfolio(e.target.value)} placeholder="Portfolio URL (optional)" />
            </div>
          </div>

          {/* About + AI generate */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Label>About / bio</Label>
              <button type="button" onClick={genCopy} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg bg-violet px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Generate from resume
              </button>
            </div>
            <TextArea rows={4} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="A few sentences about you — or Generate from resume…" />
            {resumes.length > 0 && (
              <Select className="mt-2" value="" onChange={(e) => { const d = resumes.find((r) => r.id === e.target.value); if (d) setResumeText(d.content.result || d.content.resumeText || ""); }}>
                <option value="">Use a saved resume for AI copy…</option>
                {resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </Select>
            )}
            <TextArea className="mt-2" rows={3} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="…or paste resume text here for AI copy" />
          </div>

          {/* Sections */}
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

          {publishedUrl && (
            <div className="rounded-xl border border-teal/40 bg-teal/10 p-3">
              <p className="text-xs font-semibold text-teal">{alreadyPublished ? "Published" : "Published!"}</p>
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
        <div className="flex min-h-0 flex-col bg-navy/40 p-4">
          <div className="mb-3 flex items-center justify-center gap-2">
            <button type="button" onClick={() => setDevice("desktop")} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors", device === "desktop" ? "border-violet bg-violet/15 text-white" : "border-border-gold text-muted-cream hover:bg-white/5")}>
              <Monitor className="h-3.5 w-3.5" /> Desktop
            </button>
            <button type="button" onClick={() => setDevice("mobile")} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors", device === "mobile" ? "border-violet bg-violet/15 text-white" : "border-border-gold text-muted-cream hover:bg-white/5")}>
              <Smartphone className="h-3.5 w-3.5" /> Mobile
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto">
            <div
              className="overflow-hidden rounded-xl border border-border-gold bg-white transition-all"
              style={device === "mobile" ? { width: 390, height: "100%", maxWidth: "100%" } : { width: "100%", height: "100%" }}
            >
              <iframe title="Website preview" srcDoc={previewHtml} className="h-full w-full" style={{ minHeight: 360 }} />
            </div>
          </div>
        </div>
      </div>
    </ToolModal>
  );
}

/** A tiny CSS mock of each template, tinted by the current accent. */
function TemplateThumb({ id, accent }: { id: string; accent: string }) {
  const base = "flex h-16 w-full flex-col gap-1 overflow-hidden rounded-md p-2";
  if (id === "creative") {
    return (
      <div className={base} style={{ background: `linear-gradient(135deg, ${accent}, #111)` }}>
        <div className="mx-auto mt-1 h-3 w-10 rounded bg-white/80" />
        <div className="mx-auto h-1.5 w-14 rounded bg-white/50" />
      </div>
    );
  }
  if (id === "minimal") {
    return (
      <div className={cn(base, "bg-white")}>
        <div className="h-2.5 w-10 rounded bg-neutral-800" />
        <div className="h-1 w-16 rounded bg-neutral-300" />
        <div className="mt-1 h-1 w-full rounded bg-neutral-200" />
        <div className="h-1 w-4/5 rounded bg-neutral-200" />
      </div>
    );
  }
  if (id === "resume") {
    return (
      <div className={cn(base, "bg-white")} style={{ borderTop: `3px solid ${accent}` }}>
        <div className="h-2 w-12 rounded bg-neutral-800" />
        <div className="h-1 w-16 rounded" style={{ background: accent }} />
        <div className="mt-1 h-1 w-full rounded bg-neutral-200" />
        <div className="h-1 w-3/4 rounded bg-neutral-200" />
      </div>
    );
  }
  // portfolio
  return (
    <div className={cn(base, "bg-white")} style={{ borderTop: `4px solid ${accent}` }}>
      <div className="h-3 w-3 rounded-full" style={{ background: accent }} />
      <div className="h-2 w-10 rounded bg-neutral-800" />
      <div className="mt-0.5 grid grid-cols-3 gap-1">
        <div className="h-3 rounded bg-neutral-200" /><div className="h-3 rounded bg-neutral-200" /><div className="h-3 rounded bg-neutral-200" />
      </div>
    </div>
  );
}
