"use client";

import { useRef, useState } from "react";
import { Check, UploadCloud, Trash2 } from "lucide-react";
import { INDUSTRIES, COMPANY_SIZES, type EmployerProfile, type EmailSignature } from "@/lib/employer-ai";
import { Panel, PageHeader, Btn, Field, Input, Picker } from "../components/ui";

export function SettingsClient({ initial, canManage, tier }: { initial: EmployerProfile; canManage: boolean; tier: string | null }) {
  const [companyName, setCompanyName] = useState(initial.companyName);
  const [companyWebsite, setCompanyWebsite] = useState(initial.companyWebsite);
  const [industry, setIndustry] = useState(initial.industry);
  const [companySize, setCompanySize] = useState(initial.companySize);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (companyName.trim().length < 2) return setError("Company name is required.");
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/employer/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, companyWebsite, industry, companySize }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || "Could not save.");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle="Your company profile and plan." />

      <Panel>
        <h2 className="mb-4 text-sm font-semibold text-cream">Company profile</h2>
        <div className="space-y-4">
          <Field label="Company name">
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} disabled={!canManage} />
          </Field>
          <Field label="Company website" hint="Optional">
            <Input value={companyWebsite} onChange={(e) => setCompanyWebsite(e.target.value)} disabled={!canManage} placeholder="https://…" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Industry">
              <Picker value={industry} onChange={(e) => setIndustry(e.target.value)} disabled={!canManage}>
                <option value="">Select…</option>
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </Picker>
            </Field>
            <Field label="Company size">
              <Picker value={companySize} onChange={(e) => setCompanySize(e.target.value)} disabled={!canManage}>
                <option value="">Select…</option>
                {COMPANY_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s} employees
                  </option>
                ))}
              </Picker>
            </Field>
          </div>

          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

          {canManage ? (
            <div className="flex items-center gap-3">
              <Btn onClick={save} loading={saving}>
                Save changes
              </Btn>
              {saved && (
                <span className="inline-flex items-center gap-1 text-sm text-teal">
                  <Check className="h-4 w-4" /> Saved
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-white/45">Only the account owner can edit the company profile.</p>
          )}
        </div>
      </Panel>

      <EmailSignatureSection initial={initial.emailSignature ?? null} canManage={canManage} />

      <Panel className="mt-4">
        <h2 className="mb-2 text-sm font-semibold text-cream">Plan</h2>
        <p className="text-sm text-white/70">
          Employer{tier ? ` · ${tier.charAt(0).toUpperCase() + tier.slice(1)}` : ""} plan. Billing is managed on{" "}
          <a href="https://resumetailored.com" className="text-violet hover:underline">
            resumetailored.com
          </a>
          .
        </p>
      </Panel>
    </div>
  );
}

// ── Email signature ─────────────────────────────────────────────────────────────
function EmailSignatureSection({ initial, canManage }: { initial: EmailSignature | null; canManage: boolean }) {
  const [displayName, setDisplayName] = useState(initial?.displayName || "");
  const [title, setTitle] = useState(initial?.title || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [address, setAddress] = useState(initial?.address || "");
  const [footer, setFooter] = useState(initial?.footer || "");
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasContent = !!(displayName.trim() || title.trim() || phone.trim() || address.trim() || footer.trim());

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/employer/email-signature/asset", { method: "POST", body: fd });
      const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !d.url) throw new Error(d.error || "Upload failed.");
      setLogoUrl(d.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/employer/email-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, title, phone, address, footer, logoUrl }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || "Could not save.");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel className="mt-4">
      <h2 className="mb-1 text-sm font-semibold text-cream">Email signature</h2>
      <p className="mb-4 text-xs text-white/55">
        Appended to every email your company sends — interview invites, e-signature requests, document confirmations, and
        team invites. Leave it blank to use the default footer only.
      </p>

      <div className="space-y-4">
        {/* Logo / photo */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted-cream">Logo or photo</label>
          <div className="flex items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Signature logo" className="h-14 w-14 rounded-lg object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-border-gold text-white/30">
                <UploadCloud className="h-5 w-5" />
              </div>
            )}
            {canManage && (
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
                <Btn variant="ghost" onClick={() => fileRef.current?.click()} loading={uploading}>
                  <UploadCloud className="h-4 w-4" /> {logoUrl ? "Replace" : "Upload"}
                </Btn>
                {logoUrl && (
                  <Btn variant="ghost" onClick={() => setLogoUrl("")}>
                    <Trash2 className="h-4 w-4" /> Remove
                  </Btn>
                )}
              </div>
            )}
          </div>
          <p className="mt-1 text-[11px] text-white/35">PNG, JPEG, or WebP · up to 2 MB.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Display name" hint="Optional">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={!canManage} placeholder="Jordan Rivera" />
          </Field>
          <Field label="Title" hint="Optional">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canManage} placeholder="Head of Talent, Acme Inc." />
          </Field>
          <Field label="Phone" hint="Optional">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!canManage} placeholder="+1 (555) 123-4567" />
          </Field>
          <Field label="Address" hint="Optional">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canManage} placeholder="123 Market St, San Francisco, CA" />
          </Field>
        </div>
        <Field label="Footer line" hint="Optional — e.g. a confidentiality note">
          <Input value={footer} onChange={(e) => setFooter(e.target.value)} disabled={!canManage} placeholder="This email may contain confidential information." />
        </Field>

        {/* Live preview */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted-cream">Preview</label>
          <div className="rounded-lg border border-border-gold bg-white p-4">
            {hasContent || logoUrl ? (
              <div className="flex items-start gap-3">
                {logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="h-14 w-14 rounded-lg object-cover" />
                )}
                <div className="text-sm leading-snug">
                  {displayName.trim() && <div className="font-semibold text-[#1a1a1a]">{displayName}</div>}
                  {title.trim() && <div className="text-[#555]">{title}</div>}
                  {phone.trim() && <div className="text-[#555]">{phone}</div>}
                  {address.trim() && <div className="text-[#555]">{address}</div>}
                  {footer.trim() && <div className="mt-2 text-xs text-[#888]">{footer}</div>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-[#888]">No signature — emails use the default footer only.</p>
            )}
          </div>
        </div>

        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

        {canManage ? (
          <div className="flex items-center gap-3">
            <Btn onClick={save} loading={saving}>
              Save signature
            </Btn>
            {saved && (
              <span className="inline-flex items-center gap-1 text-sm text-teal">
                <Check className="h-4 w-4" /> Saved
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-white/45">Only the account owner can edit the email signature.</p>
        )}
      </div>
    </Panel>
  );
}
