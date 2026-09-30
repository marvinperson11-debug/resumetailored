"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link2, Copy, Check, ExternalLink, Globe, Loader2, ImagePlus, X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTools } from "../components/tools-context";
import { SHARE_THEMES, type ShareableProfile, type ContactInfo } from "@/lib/shareable-store";
import { imageToDataUrl } from "@/app/candidate/studio/edit/studio-shared";

const inputCn = "w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2.5 text-sm text-cream placeholder:text-white/30 outline-none focus:border-violet";

/**
 * Shareable Link (FREE) editor. A simple form-based public profile at
 * /u/<username> — separate from the Pro Website Creator (/site/<slug>). Shows
 * both URLs and a prominent upgrade CTA to the full builder.
 */
export function ShareableLinks() {
  const { isPro } = useTools();
  const t = useTranslations("shareableLinks");
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [siteUrl, setSiteUrl] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [headline, setHeadline] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [bio, setBio] = useState("");
  const [contact, setContact] = useState<ContactInfo>({});
  const [theme, setTheme] = useState("aurora");
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [uAvail, setUAvail] = useState<"idle" | "checking" | "ok" | "taken" | "invalid">("idle");
  const photoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/shareable", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { profile: null }))
      .then((d: { profile?: ShareableProfile | null; url?: string | null }) => {
        if (d.profile) {
          setUsername(d.profile.username);
          setName(d.profile.name);
          setHeadline(d.profile.headline);
          setPhotoUrl(d.profile.photoUrl);
          setBio(d.profile.bio);
          setContact(d.profile.contact || {});
          setTheme(d.profile.theme || "aurora");
          setPublicUrl(d.url || null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // The Pro Website Creator URL (if published) — shown alongside.
    fetch("/api/personal-website/mine", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { site: null }))
      .then((d: { site?: { url?: string; published?: boolean } | null }) => { if (d.site?.published) setSiteUrl(d.site.url || null); })
      .catch(() => {});
  }, []);

  // Debounced username availability check.
  useEffect(() => {
    if (!username) { setUAvail("idle"); return; }
    setUAvail("checking");
    const id = setTimeout(() => {
      fetch(`/api/shareable?check=${encodeURIComponent(username)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { available?: boolean; reason?: string }) => setUAvail(d.reason === "invalid" ? "invalid" : d.available ? "ok" : "taken"))
        .catch(() => setUAvail("idle"));
    }, 400);
    return () => clearTimeout(id);
  }, [username]);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { setError(t("imageTooLarge")); return; }
    setPhotoUrl(await imageToDataUrl(f, 640));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/shareable", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, name, headline, photoUrl, bio, contact, theme }),
      });
      const d = (await res.json().catch(() => ({}))) as { url?: string; message?: string; error?: string };
      if (!res.ok) throw new Error(d.message || t("errors.save"));
      setPublicUrl(d.url || null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setSaving(false);
    }
  }

  const setC = (patch: Partial<ContactInfo>) => setContact((c) => ({ ...c, ...patch }));

  if (loading) {
    return <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border border-border-gold bg-white/[0.03] p-6 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-medium text-cream">{t("title")}</h1>
        <p className="mt-1 text-sm text-white/60">{t("subtitle")}</p>
      </div>

      {/* Your links */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border-gold bg-white/[0.03] p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-cream"><Link2 className="h-4 w-4 text-teal" /> {t("freeLink")}</div>
          {publicUrl ? (
            <div className="flex items-center gap-2">
              <input readOnly value={publicUrl} onFocus={(e) => e.currentTarget.select()} className={cn(inputCn, "text-xs")} />
              <button type="button" onClick={() => { navigator.clipboard?.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="rounded-lg border border-border-gold px-2.5 py-2 text-cream hover:bg-white/8">{copied ? <Check className="h-4 w-4 text-teal" /> : <Copy className="h-4 w-4" />}</button>
              <a href={publicUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-border-gold px-2.5 py-2 text-cream hover:bg-white/8"><ExternalLink className="h-4 w-4" /></a>
            </div>
          ) : <p className="text-xs text-white/50">{t("pickUsername")}</p>}
        </div>
        <div className="rounded-2xl border border-border-gold bg-white/[0.03] p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-cream"><Globe className="h-4 w-4 text-violet" /> {t("fullSite")}</div>
          {siteUrl ? (
            <div className="flex items-center gap-2">
              <input readOnly value={siteUrl} onFocus={(e) => e.currentTarget.select()} className={cn(inputCn, "text-xs")} />
              <a href={siteUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-border-gold px-2.5 py-2 text-cream hover:bg-white/8"><ExternalLink className="h-4 w-4" /></a>
            </div>
          ) : (
            <button type="button" onClick={() => router.push(isPro ? "/candidate/studio" : "/candidate?upgrade=pro")} className="text-xs font-medium text-violet hover:text-violet/80">{t("buildSite")}</button>
          )}
        </div>
      </div>

      {/* Editor form */}
      <div className="space-y-4 rounded-2xl border border-border-gold bg-white/[0.03] p-5">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/45">{t("username")}</label>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-white/40">/u/</span>
            <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ""))} placeholder={t("usernamePh")} className={inputCn} />
          </div>
          <p className="mt-1 text-[11px]">
            {uAvail === "checking" && <span className="text-white/40">{t("avail.checking")}</span>}
            {uAvail === "ok" && <span className="text-teal">{t("avail.ok")}</span>}
            {uAvail === "taken" && <span className="text-red-300">{t("avail.taken")}</span>}
            {uAvail === "invalid" && <span className="text-amber-300">{t("avail.invalid")}</span>}
            {uAvail === "idle" && <span className="text-white/35">{t("avail.idle")}</span>}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/45">{t("name")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePh")} className={inputCn} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/45">{t("headline")}</label>
            <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder={t("headlinePh")} className={inputCn} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/45">{t("photo")}</label>
          <input ref={photoRef} type="file" accept="image/*" hidden onChange={onPhoto} />
          {photoUrl ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
              <button type="button" onClick={() => setPhotoUrl("")} className="inline-flex items-center gap-1 rounded-lg border border-border-gold px-2.5 py-2 text-xs text-cream hover:bg-white/8"><X className="h-3.5 w-3.5" /> {t("remove")}</button>
            </div>
          ) : (
            <button type="button" onClick={() => photoRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border-gold px-3 py-2.5 text-xs text-muted-cream hover:bg-white/5"><ImagePlus className="h-4 w-4" /> {t("uploadPhoto")}</button>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/45">{t("bio")}</label>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} placeholder={t("bioPh")} className={cn(inputCn, "resize-y")} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/45">{t("email")}</label><input value={contact.email || ""} onChange={(e) => setC({ email: e.target.value })} placeholder={t("emailPh")} className={inputCn} /></div>
          <div><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/45">{t("phone")}</label><input value={contact.phone || ""} onChange={(e) => setC({ phone: e.target.value })} placeholder={t("phonePh")} className={inputCn} /></div>
          <div><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/45">{t("location")}</label><input value={contact.location || ""} onChange={(e) => setC({ location: e.target.value })} placeholder={t("locationPh")} className={inputCn} /></div>
          <div><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/45">{t("linkedin")}</label><input value={contact.linkedin || ""} onChange={(e) => setC({ linkedin: e.target.value })} placeholder={t("linkedinPh")} className={inputCn} /></div>
          <div className="sm:col-span-2"><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/45">{t("website")}</label><input value={contact.website || ""} onChange={(e) => setC({ website: e.target.value })} placeholder={t("websitePh")} className={inputCn} /></div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-white/45">{t("theme")}</label>
          <div className="flex flex-wrap gap-2">
            {SHARE_THEMES.map((th) => (
              <button key={th.id} type="button" onClick={() => setTheme(th.id)} title={t(`themes.${th.id}`)} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors", theme === th.id ? "border-violet bg-violet/15 text-cream" : "border-border-gold text-muted-cream hover:bg-white/5")}>
                <span className="h-4 w-4 rounded-full" style={{ background: th.accent }} />{t(`themes.${th.id}`)}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={saving || uAvail === "taken" || uAvail === "invalid"} className="inline-flex items-center gap-2 rounded-xl bg-violet px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_18px_rgba(194,135,11,0.32)] disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
            {saved ? t("saved") : publicUrl ? t("update") : t("create")}
          </button>
          {publicUrl && <a href={publicUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-violet hover:text-violet/80">{t("view")}</a>}
        </div>
      </div>

      {/* Upgrade CTA */}
      <button
        type="button"
        onClick={() => router.push(isPro ? "/candidate/studio" : "/candidate?upgrade=pro")}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-violet/40 bg-gradient-to-r from-violet/15 to-transparent px-5 py-4 text-left transition-colors hover:from-violet/25"
      >
        <span className="flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-violet" />
          <span>
            <span className="block text-sm font-semibold text-cream">{t("cta.title")}</span>
            <span className="block text-xs text-white/60">{t("cta.body")}</span>
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-violet px-3 py-1.5 text-xs font-bold text-white">{isPro ? t("cta.openBuilder") : t("cta.goPro")}</span>
      </button>
    </div>
  );
}
