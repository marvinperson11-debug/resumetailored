"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { Camera, Check, ExternalLink, Loader2, User as UserIcon, Contact } from "lucide-react";
import type { UserProfile } from "@/lib/profile-store";
import { LinkedInImportModal } from "../components/linkedin-import-modal";

const card = "rounded-2xl border border-border-gold bg-white/[0.03] p-6";
const labelCls = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-cream";
const inputCls =
  "w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-white/35 outline-none transition-colors focus:border-violet focus:ring-1 focus:ring-violet disabled:opacity-60";

export function ProfileClient({ initial }: { initial: UserProfile }) {
  const { user, isLoaded } = useUser();
  const fileRef = useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState(initial.phone);
  const [location, setLocation] = useState(initial.location);
  const [linkedinUrl, setLinkedinUrl] = useState(initial.linkedinUrl);
  const [websiteUrl, setWebsiteUrl] = useState(initial.websiteUrl);
  const [bio, setBio] = useState(initial.bio);

  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [linkedinOpen, setLinkedinOpen] = useState(false);

  // Seed the Clerk-backed name fields once the user loads.
  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || "");
      setLastName(user.lastName || "");
    }
  }, [user]);

  // Surface a "View my public site" link if the user has published one.
  useEffect(() => {
    fetch("/api/personal-website/mine", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { site?: { url?: string } } | null) => {
        if (d?.site?.url) setSiteUrl(d.site.url);
      })
      .catch(() => {});
  }, []);

  const email = user?.primaryEmailAddress?.emailAddress || "";
  const imageUrl = user?.imageUrl;

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user || photoBusy) return;
    setPhotoBusy(true);
    setError(null);
    try {
      await user.setProfileImage({ file });
      await user.reload();
    } catch {
      setError("Could not upload that photo. Try a smaller PNG or JPG.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      // Name → Clerk (source of truth). Ignore if unchanged/unavailable.
      if (user && (firstName !== (user.firstName || "") || lastName !== (user.lastName || ""))) {
        await user.update({ firstName, lastName });
      }
      // Extra fields → Supabase.
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, location, linkedinUrl, websiteUrl, bio }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || "Could not save your profile.");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-medium text-cream">Profile</h1>
          <p className="mt-1 text-sm text-white/60">Your details — used to pre-fill your resumes, cover letters, and personal site.</p>
        </div>
        <button
          type="button"
          onClick={() => setLinkedinOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-border-gold px-3 py-2 text-sm font-medium text-cream transition-colors hover:bg-white/8"
        >
          <Contact className="h-4 w-4 text-[#0A66C2]" /> Import from LinkedIn
        </button>
      </div>

      {/* Photo + name */}
      <div className={card}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="relative shrink-0">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
                <UserIcon className="h-8 w-8 text-white/40" />
              </div>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={photoBusy || !isLoaded}
              className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-navy bg-violet text-white transition-colors hover:bg-violet/90 disabled:opacity-60"
              aria-label="Change photo"
            >
              {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onPhoto} />
          </div>
          <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>First name</label>
              <input className={inputCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={!isLoaded} />
            </div>
            <div>
              <label className={labelCls}>Last name</label>
              <input className={inputCls} value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={!isLoaded} />
            </div>
          </div>
        </div>
      </div>

      {/* Contact + links */}
      <div className={card}>
        <h2 className="mb-4 text-sm font-semibold text-cream">Contact &amp; links</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Email</label>
            <input className={inputCls} value={email} disabled readOnly />
            <p className="mt-1 text-[11px] text-white/35">Managed by your account — change it in Settings.</p>
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 012-3456" />
          </div>
          <div>
            <label className={labelCls}>Location</label>
            <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, State" />
          </div>
          <div>
            <label className={labelCls}>LinkedIn URL</label>
            <input className={inputCls} value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/…" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Portfolio / Website</label>
            <input className={inputCls} value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://…" />
          </div>
        </div>
      </div>

      {/* Bio */}
      <div className={card}>
        <h2 className="mb-4 text-sm font-semibold text-cream">About me</h2>
        <textarea
          className={inputCls + " resize-y"}
          rows={4}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="A short professional bio — a sentence or two about who you are and what you do."
        />
      </div>

      {siteUrl && (
        <a
          href={siteUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between gap-3 rounded-2xl border border-border-gold bg-white/[0.03] px-5 py-4 text-sm text-cream transition-colors hover:bg-white/[0.06]"
        >
          <span className="flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-violet" /> View my public site
          </span>
          <span className="truncate text-xs text-white/45">{siteUrl.replace(/^https?:\/\//, "")}</span>
        </a>
      )}

      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="sticky bottom-0 flex items-center gap-3 border-t border-border-gold bg-navy/80 py-4 backdrop-blur">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-violet px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet/90 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save profile
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm text-teal">
            <Check className="h-4 w-4" /> Saved
          </span>
        )}
      </div>

      {linkedinOpen && (
        <LinkedInImportModal
          onClose={() => setLinkedinOpen(false)}
          onApply={(p) => {
            if (p.name) {
              const parts = p.name.trim().split(/\s+/);
              setFirstName(parts[0] || "");
              setLastName(parts.slice(1).join(" "));
            }
            if (p.location) setLocation(p.location);
            const nextBio = p.summary || p.headline;
            if (nextBio) setBio(nextBio);
            setLinkedinOpen(false);
          }}
        />
      )}
    </div>
  );
}
