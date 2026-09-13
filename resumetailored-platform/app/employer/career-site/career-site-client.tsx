"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe, Plus, X, Check, Copy, ExternalLink, Upload, ImageIcon } from "lucide-react";
import { Panel, PageHeader, Btn, Field, Input, Area } from "../components/ui";
import { CareerSiteView } from "@/app/careers/[slug]/career-site-view";
import { careerSubdomainUrl, normalizeSlug, isValidSlug, ROOT_DOMAIN } from "@/lib/subdomain";
import type { CareerSite, Testimonial, PublicCareerJob, JobPosting } from "@/lib/employer-ai";

type Toggle = "showAbout" | "showBenefits" | "showTeam" | "showTestimonials" | "showContact";
type ImgMode = "upload" | "url";

const ALLOWED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

/** Logo/banner field with an Upload | URL toggle. Uploads happen on Save. */
function ImageField({
  label,
  helper,
  mode,
  onMode,
  url,
  onUrl,
  file,
  onFile,
  previewUrl,
  onError,
}: {
  label: string;
  helper: string;
  mode: ImgMode;
  onMode: (m: ImgMode) => void;
  url: string;
  onUrl: (v: string) => void;
  file: File | null;
  onFile: (f: File | null) => void;
  previewUrl: string;
  onError: (msg: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const seg = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${active ? "bg-violet text-white" : "text-muted-cream hover:text-cream"}`;

  function pick(f: File | null) {
    onError(null);
    if (!f) return;
    if (!ALLOWED.includes(f.type)) return onError(`${label}: please choose a PNG, JPEG, or WebP image.`);
    if (f.size > MAX_BYTES) return onError(`${label}: image is too large — keep it under 2 MB.`);
    onFile(f);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-cream">{label}</span>
        <div className="flex items-center gap-0.5 rounded-lg border border-border-gold bg-white/[0.03] p-0.5">
          <button type="button" className={seg(mode === "upload")} onClick={() => onMode("upload")}>
            Upload
          </button>
          <button type="button" className={seg(mode === "url")} onClick={() => onMode("url")}>
            URL
          </button>
        </div>
      </div>

      {mode === "upload" ? (
        <div className="rounded-lg border border-border-gold bg-white/[0.03] p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-gold bg-white/5">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-5 w-5 text-white/35" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => pick(e.target.files?.[0] || null)}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream hover:bg-white/[0.08]"
              >
                <Upload className="h-3.5 w-3.5" /> {file || previewUrl ? "Replace image" : "Choose image"}
              </button>
              {file && (
                <span className="ml-2 text-xs text-white/55">
                  {file.name}{" "}
                  <button type="button" onClick={() => onFile(null)} className="text-white/40 hover:text-cream">
                    (remove)
                  </button>
                </span>
              )}
              <p className="mt-1 text-[11px] text-white/40">Uploaded images are served from our CDN.</p>
            </div>
          </div>
        </div>
      ) : (
        <Input value={url} onChange={(e) => onUrl(e.target.value)} placeholder="https://…" />
      )}
      <span className="mt-1 block text-xs text-white/40">{helper}</span>
    </div>
  );
}

export function CareerSiteClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDraft, setSlugDraft] = useState("");
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [jobs, setJobs] = useState<PublicCareerJob[]>([]);

  // Form state
  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [logoMode, setLogoMode] = useState<ImgMode>("url");
  const [bannerMode, setBannerMode] = useState<ImgMode>("url");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [brandColor, setBrandColor] = useState("#F59E0B");
  const [aboutText, setAboutText] = useState("");
  const [missionText, setMissionText] = useState("");
  const [valuesText, setValuesText] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [toggles, setToggles] = useState<Record<Toggle, boolean>>({
    showAbout: true,
    showBenefits: true,
    showTeam: false,
    showTestimonials: false,
    showContact: true,
  });
  const [benefits, setBenefits] = useState<string[]>([]);
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const applyFromSite = useCallback((s: CareerSite) => {
    setSlug(s.slug);
    setSlugDraft(s.slug);
    setCompanyName(s.companyName);
    setLogoUrl(s.logoUrl);
    setBannerUrl(s.bannerUrl);
    setBrandColor(s.brandColor || "#F59E0B");
    setAboutText(s.aboutText);
    setMissionText(s.missionText);
    setValuesText(s.valuesText);
    setContactEmail(s.contactEmail);
    setToggles({
      showAbout: s.showAbout,
      showBenefits: s.showBenefits,
      showTeam: s.showTeam,
      showTestimonials: s.showTestimonials,
      showContact: s.showContact,
    });
    setBenefits(s.benefits);
    setTestimonials(s.testimonials);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/employer/career-site", { cache: "no-store" });
        const d = (await res.json().catch(() => ({}))) as { site?: CareerSite; error?: string };
        if (d.site) applyFromSite(d.site);
        else setError(d.error || "Could not load your career site.");
      } finally {
        setLoading(false);
      }
      // Active + public jobs for a realistic preview.
      fetch("/api/employer/jobs", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { jobs?: JobPosting[] }) => {
          const active = (d.jobs || []).filter((j) => j.status === "active" && j.publicListed);
          setJobs(
            active.map((j) => ({
              id: j.id,
              title: j.title,
              department: j.department,
              location: j.location,
              remoteType: j.remoteType,
              employmentType: j.employmentType,
              salaryMin: j.salaryMin,
              salaryMax: j.salaryMax,
              salaryCurrency: j.salaryCurrency,
              description: j.description,
              requirements: j.requirements,
            }))
          );
        })
        .catch(() => {});
    })();
  }, [applyFromSite]);

  // Object URLs so a freshly-picked (not-yet-uploaded) file previews live.
  const logoObjUrl = useMemo(() => (logoFile ? URL.createObjectURL(logoFile) : ""), [logoFile]);
  const bannerObjUrl = useMemo(() => (bannerFile ? URL.createObjectURL(bannerFile) : ""), [bannerFile]);
  useEffect(() => () => { if (logoObjUrl) URL.revokeObjectURL(logoObjUrl); }, [logoObjUrl]);
  useEffect(() => () => { if (bannerObjUrl) URL.revokeObjectURL(bannerObjUrl); }, [bannerObjUrl]);
  const effLogo = logoMode === "upload" && logoObjUrl ? logoObjUrl : logoUrl;
  const effBanner = bannerMode === "upload" && bannerObjUrl ? bannerObjUrl : bannerUrl;

  const previewSite: CareerSite = useMemo(
    () => ({
      id: 0,
      companyName,
      slug,
      logoUrl: effLogo,
      bannerUrl: effBanner,
      brandColor,
      aboutText,
      missionText,
      valuesText,
      contactEmail,
      ...toggles,
      benefits,
      testimonials,
      createdAt: "",
      updatedAt: "",
    }),
    [companyName, slug, effLogo, effBanner, brandColor, aboutText, missionText, valuesText, contactEmail, toggles, benefits, testimonials]
  );

  // Primary address is the subdomain (works after save); the path is the alternate.
  const subdomainUrl = slug ? careerSubdomainUrl(slug) : "";
  const pathUrl = slug ? (origin ? `${origin}/careers/${slug}` : `/careers/${slug}`) : "";
  const publicUrl = subdomainUrl;

  const slugCand = normalizeSlug(slugDraft);
  const slugChanged = !!slugCand && slugCand !== slug;

  // Debounced availability check while editing the slug.
  useEffect(() => {
    if (!slugChanged) {
      setSlugStatus("idle");
      return;
    }
    if (!isValidSlug(slugCand)) {
      setSlugStatus("invalid");
      return;
    }
    setSlugStatus("checking");
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/employer/career-site/slug-available?slug=${encodeURIComponent(slugCand)}`, { cache: "no-store" });
        const d = (await r.json().catch(() => ({}))) as { valid?: boolean; available?: boolean };
        setSlugStatus(d.valid && d.available ? "available" : d.valid ? "taken" : "invalid");
      } catch {
        setSlugStatus("idle");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [slugCand, slugChanged]);

  async function save() {
    if (slugChanged && slugStatus !== "available") {
      setError(slugStatus === "checking" ? "Still checking the address — try again in a second." : "Please choose an available career-site address.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Upload any freshly-picked files first, then persist the resolved URLs.
      const uploadOne = async (f: File, label: string): Promise<string> => {
        const fd = new FormData();
        fd.append("file", f);
        const r = await fetch("/api/employer/career-site/upload", { method: "POST", body: fd });
        const d = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!r.ok || !d.url) throw new Error(d.error || `Could not upload ${label}.`);
        return d.url;
      };
      let nextLogo = logoUrl;
      let nextBanner = bannerUrl;
      if (logoMode === "upload" && logoFile) nextLogo = await uploadOne(logoFile, "logo");
      if (bannerMode === "upload" && bannerFile) nextBanner = await uploadOne(bannerFile, "banner");

      const res = await fetch("/api/employer/career-site", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(slugChanged ? { slug: slugCand } : {}),
          companyName,
          logoUrl: nextLogo,
          bannerUrl: nextBanner,
          brandColor,
          aboutText,
          missionText,
          valuesText,
          contactEmail,
          ...toggles,
          benefits: benefits.map((b) => b.trim()).filter(Boolean),
          testimonials: testimonials.filter((t) => t.quote.trim() && t.author.trim()),
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { site?: CareerSite; error?: string };
      if (!res.ok || !d.site) throw new Error(d.error || "Could not save.");
      applyFromSite(d.site);
      setLogoFile(null);
      setBannerFile(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  function copyUrl() {
    if (!publicUrl) return;
    navigator.clipboard?.writeText(publicUrl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {}
    );
  }

  const setToggle = (k: Toggle) => setToggles((t) => ({ ...t, [k]: !t[k] }));

  return (
    <div>
      <PageHeader
        title="Career Site Builder"
        subtitle="A public careers page that auto-lists your active roles."
        action={
          <Btn onClick={save} loading={saving}>
            {saved ? (
              <>
                <Check className="h-4 w-4" /> Saved
              </>
            ) : (
              "Save changes"
            )}
          </Btn>
        }
      />

      {/* Public URL bar — subdomain is the primary address */}
      <Panel className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Globe className="h-4 w-4 shrink-0 text-violet" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-cream">Public URL</span>
          <code className="min-w-0 flex-1 truncate rounded-md border border-border-gold bg-white/5 px-2.5 py-1.5 text-sm text-cream">
            {publicUrl || "…"}
          </code>
          <button type="button" onClick={copyUrl} disabled={!publicUrl} className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream hover:bg-white/[0.08] disabled:opacity-50">
            {copied ? <Check className="h-3.5 w-3.5 text-teal" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          {publicUrl && (
            <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream hover:bg-white/[0.08]">
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </a>
          )}
        </div>
        {pathUrl && (
          <p className="mt-2 pl-7 text-xs text-white/40">
            Also reachable at <span className="text-white/55">{pathUrl}</span>
          </p>
        )}
      </Panel>

      {error && <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      {loading ? (
        <Panel className="text-sm text-white/50">Loading…</Panel>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* ── Form ── */}
          <div className="space-y-4">
            <Panel className="space-y-4">
              <h2 className="text-sm font-semibold text-cream">Branding</h2>
              <div>
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-cream">Career site address</span>
                <div className="flex items-center rounded-lg border border-border-gold bg-white/5 focus-within:border-violet focus-within:ring-1 focus-within:ring-violet">
                  <input
                    value={slugDraft}
                    onChange={(e) => setSlugDraft(e.target.value)}
                    placeholder="your-company"
                    className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-cream outline-none placeholder:text-white/35"
                  />
                  <span className="shrink-0 whitespace-nowrap px-3 text-sm text-white/45">.{ROOT_DOMAIN}</span>
                </div>
                <div className="mt-1 text-xs">
                  {slugStatus === "checking" && <span className="text-white/45">Checking availability…</span>}
                  {slugStatus === "available" && <span className="text-teal">✓ {slugCand}.{ROOT_DOMAIN} is available</span>}
                  {slugStatus === "taken" && <span className="text-red-300">That address is already taken.</span>}
                  {slugStatus === "invalid" && <span className="text-red-300">Use lowercase letters, numbers, and hyphens (not a reserved word).</span>}
                  {slugStatus === "idle" && !slugChanged && <span className="text-white/40">Your site&rsquo;s primary address.</span>}
                </div>
                {slugChanged && slugStatus === "available" && (
                  <p className="mt-1.5 text-xs text-gold">
                    Heads up: this changes your primary domain — previously shared links (your old subdomain and <code>/careers</code> link) will stop working.
                  </p>
                )}
              </div>
              <Field label="Company name">
                <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Inc." />
              </Field>
              <ImageField
                label="Logo"
                helper="Tip: a square PNG under 1 MB works best for logos."
                mode={logoMode}
                onMode={setLogoMode}
                url={logoUrl}
                onUrl={setLogoUrl}
                file={logoFile}
                onFile={setLogoFile}
                previewUrl={effLogo}
                onError={setError}
              />
              <ImageField
                label="Banner"
                helper="Tip: a wide banner image at least 1200px wide works best."
                mode={bannerMode}
                onMode={setBannerMode}
                url={bannerUrl}
                onUrl={setBannerUrl}
                file={bannerFile}
                onFile={setBannerFile}
                previewUrl={effBanner}
                onError={setError}
              />
              <Field label="Brand color">
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(brandColor) ? brandColor : "#F59E0B"}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded border border-border-gold bg-transparent p-0.5"
                    aria-label="Brand color"
                  />
                  <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="max-w-[140px]" placeholder="#F59E0B" />
                </div>
              </Field>
            </Panel>

            <Panel className="space-y-4">
              <h2 className="text-sm font-semibold text-cream">Content</h2>
              <Field label="About">
                <Area rows={3} value={aboutText} onChange={(e) => setAboutText(e.target.value)} placeholder="Tell candidates who you are…" />
              </Field>
              <Field label="Mission">
                <Area rows={2} value={missionText} onChange={(e) => setMissionText(e.target.value)} />
              </Field>
              <Field label="Values">
                <Area rows={2} value={valuesText} onChange={(e) => setValuesText(e.target.value)} />
              </Field>
              <Field label="Contact email" hint="Shown in the Get in touch section">
                <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="careers@acme.com" />
              </Field>
            </Panel>

            <Panel className="space-y-3">
              <h2 className="text-sm font-semibold text-cream">Sections</h2>
              {(
                [
                  ["showAbout", "About / Mission / Values"],
                  ["showBenefits", "Benefits & perks"],
                  ["showTeam", "Meet the team"],
                  ["showTestimonials", "Testimonials"],
                  ["showContact", "Contact"],
                ] as [Toggle, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setToggle(key)}
                  className="flex w-full items-center justify-between rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2.5 text-left text-sm text-cream hover:bg-white/[0.06]"
                >
                  <span>{label}</span>
                  <span className={`flex h-5 w-9 items-center rounded-full px-0.5 transition-colors ${toggles[key] ? "justify-end bg-violet" : "justify-start bg-white/15"}`}>
                    <span className="h-4 w-4 rounded-full bg-white" />
                  </span>
                </button>
              ))}
            </Panel>

            <Panel className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-cream">Benefits</h2>
                <button type="button" onClick={() => setBenefits((b) => [...b, ""])} className="inline-flex items-center gap-1 text-xs font-semibold text-violet hover:text-violet/80">
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
              {benefits.length === 0 && <p className="text-xs text-white/40">No benefits yet.</p>}
              {benefits.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={b} onChange={(e) => setBenefits((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))} placeholder="e.g. Remote-first, unlimited PTO" />
                  <button type="button" onClick={() => setBenefits((arr) => arr.filter((_, j) => j !== i))} aria-label="Remove" className="shrink-0 rounded-md p-2 text-muted-cream hover:bg-white/8 hover:text-cream">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </Panel>

            <Panel className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-cream">Testimonials</h2>
                <button type="button" onClick={() => setTestimonials((t) => [...t, { quote: "", author: "", role: "" }])} className="inline-flex items-center gap-1 text-xs font-semibold text-violet hover:text-violet/80">
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
              {testimonials.length === 0 && <p className="text-xs text-white/40">No testimonials yet.</p>}
              {testimonials.map((t, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-border-gold bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-cream">Quote {i + 1}</span>
                    <button type="button" onClick={() => setTestimonials((arr) => arr.filter((_, j) => j !== i))} aria-label="Remove" className="rounded-md p-1 text-muted-cream hover:bg-white/8 hover:text-cream">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <Area rows={2} value={t.quote} onChange={(e) => setTestimonials((arr) => arr.map((x, j) => (j === i ? { ...x, quote: e.target.value } : x)))} placeholder="What they said…" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={t.author} onChange={(e) => setTestimonials((arr) => arr.map((x, j) => (j === i ? { ...x, author: e.target.value } : x)))} placeholder="Name" />
                    <Input value={t.role || ""} onChange={(e) => setTestimonials((arr) => arr.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} placeholder="Role (optional)" />
                  </div>
                </div>
              ))}
            </Panel>
          </div>

          {/* ── Live preview ── */}
          <div className="lg:sticky lg:top-20 lg:self-start">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">Live preview</div>
            <div className="max-h-[calc(100vh-160px)] overflow-auto rounded-xl border border-border-gold bg-white">
              <CareerSiteView site={previewSite} jobs={jobs} preview />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
