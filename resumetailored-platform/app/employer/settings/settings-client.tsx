"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, UploadCloud, Trash2 } from "lucide-react";
import { INDUSTRIES, type EmployerProfile, type EmailSignature } from "@/lib/employer-ai";
import { Panel, PageHeader, Btn, Field, Input, Area, Picker, employerCheckoutHref } from "../components/ui";
import { LanguageSettingsSection } from "@/components/language-settings-section";
import { normalizeTier } from "@/lib/employer-tier";

const MANUAL = "__manual__";

export function SettingsClient({
  initial,
  canManage,
  tier,
  knownNames,
  gate,
}: {
  initial: EmployerProfile;
  canManage: boolean;
  tier: string | null;
  knownNames: string[];
  gate?: { plan: string; isAdmin: boolean };
}) {
  const t = useTranslations("employerSettings");
  const tUi = useTranslations("employerUi");
  // Always a known tier (unknown/legacy values normalise), rendered via tierNames — never raw text.
  const tierKey = normalizeTier(tier);
  const planName = tUi(`tierNames.${tierKey}`);
  const nextPlan = tierKey === "corporate" ? null : tierKey === "scale" ? "corporate" : tierKey === "portal" ? "scale" : "portal";
  // Log the editability decision once so it's verifiable from the console.
  useEffect(() => {
    console.log("[settings] editability gate", { canManage, plan: gate?.plan, isAdmin: gate?.isAdmin });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [companyName, setCompanyName] = useState(initial.companyName);
  const [companyWebsite, setCompanyWebsite] = useState(initial.companyWebsite);
  const [industry, setIndustry] = useState(initial.industry);
  const [companyBio, setCompanyBio] = useState(initial.companyBio);
  // Company-name picker: choose a known name or type a new one. Start in manual
  // mode when there are no known names, or the saved name isn't among them.
  const [nameManual, setNameManual] = useState(knownNames.length === 0 || (!!companyName && !knownNames.includes(companyName)));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onPickName(value: string) {
    if (value === MANUAL) {
      setNameManual(true);
      setCompanyName("");
    } else {
      setNameManual(false);
      setCompanyName(value);
    }
  }

  async function save() {
    if (companyName.trim().length < 2) return setError(t("errorNeedCompanyName"));
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/employer/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, companyWebsite, industry, companyBio }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || t("errorCouldNotSave"));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Panel>
        <h2 className="mb-4 text-sm font-semibold text-cream">{t("companyProfile")}</h2>
        <div className="space-y-4">
          <Field label={t("fieldCompanyName")} hint={knownNames.length > 0 ? t("hintPickOrType") : undefined}>
            {knownNames.length > 0 && (
              <Picker value={nameManual ? MANUAL : companyName} onChange={(e) => onPickName(e.target.value)} disabled={!canManage}>
                {!companyName && !nameManual && <option value="">{t("selectEllipsis")}</option>}
                {knownNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
                <option value={MANUAL}>{t("typeNewNameEllipsis")}</option>
              </Picker>
            )}
            {(nameManual || knownNames.length === 0) && (
              <Input
                className={knownNames.length > 0 ? "mt-2" : undefined}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                disabled={!canManage}
                placeholder={t("companyNamePh")}
              />
            )}
          </Field>
          <Field label={t("fieldCompanyWebsite")} hint={t("optional")}>
            <Input value={companyWebsite} onChange={(e) => setCompanyWebsite(e.target.value)} disabled={!canManage} placeholder="https://…" />
          </Field>
          <Field label={t("fieldIndustry")}>
            <Picker value={industry} onChange={(e) => setIndustry(e.target.value)} disabled={!canManage}>
              <option value="">{t("selectEllipsis")}</option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>
                  {t(`industry.${i}`)}
                </option>
              ))}
            </Picker>
          </Field>
          <Field label={t("fieldCompanyBio")} hint={t("hintCompanyBio")}>
            <Area rows={5} value={companyBio} onChange={(e) => setCompanyBio(e.target.value)} disabled={!canManage} placeholder={t("placeholderCompanyBio")} />
          </Field>

          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

          {canManage ? (
            <div className="flex items-center gap-3">
              <Btn onClick={save} loading={saving}>
                {t("saveChanges")}
              </Btn>
              {saved && (
                <span className="inline-flex items-center gap-1 text-sm text-teal">
                  <Check className="h-4 w-4" /> {t("saved")}
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-white/45">{t("onlyOwnerCanEditProfile")}</p>
          )}
        </div>
      </Panel>

      <EmailSignatureSection initial={initial.emailSignature ?? null} canManage={canManage} />

      <Panel className="mt-4">
        <h2 className="mb-2 text-sm font-semibold text-cream">{t("plan")}</h2>
        <p className="text-sm text-white/80">{t("currentPlan", { plan: planName })}</p>
        <p className="mt-1 text-sm text-white/55">
          {t("billingNote")} {t("renewalNote")}
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          {nextPlan && (
            <a href={employerCheckoutHref(nextPlan)} className="font-semibold text-gold hover:underline">
              {t("upgradeTo", { plan: tUi(`tierNames.${nextPlan}`) })}
            </a>
          )}
          <a href="mailto:support@resumetailored.com?subject=Employer%20billing" className="text-violet hover:underline">
            {t("manageBilling")}
          </a>
        </div>
      </Panel>

      <div className="mt-4">
        <LanguageSettingsSection />
      </div>
    </div>
  );
}

// ── Email signature ─────────────────────────────────────────────────────────────
function EmailSignatureSection({ initial, canManage }: { initial: EmailSignature | null; canManage: boolean }) {
  const t = useTranslations("employerSettings");
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
      if (!res.ok || !d.url) throw new Error(d.error || t("errorUploadFailed"));
      setLogoUrl(d.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorUploadFailed"));
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
      if (!res.ok) throw new Error(d.error || t("errorCouldNotSave"));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel className="mt-4">
      <h2 className="mb-1 text-sm font-semibold text-cream">{t("emailSignature")}</h2>
      <p className="mb-4 text-xs text-white/55">
        {t("emailSignatureHint")}
      </p>

      <div className="space-y-4">
        {/* Logo / photo */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted-cream">{t("logoOrPhoto")}</label>
          <div className="flex items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={t("signatureLogoAlt")} className="h-14 w-14 rounded-lg object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-border-gold text-white/30">
                <UploadCloud className="h-5 w-5" />
              </div>
            )}
            {canManage && (
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
                <Btn variant="ghost" onClick={() => fileRef.current?.click()} loading={uploading}>
                  <UploadCloud className="h-4 w-4" /> {logoUrl ? t("replace") : t("upload")}
                </Btn>
                {logoUrl && (
                  <Btn variant="ghost" onClick={() => setLogoUrl("")}>
                    <Trash2 className="h-4 w-4" /> {t("remove")}
                  </Btn>
                )}
              </div>
            )}
          </div>
          <p className="mt-1 text-[11px] text-white/35">{t("imageFormatHint")}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("fieldDisplayName")} hint={t("optional")}>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={!canManage} placeholder={t("displayNamePh")} />
          </Field>
          <Field label={t("fieldTitle")} hint={t("optional")}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canManage} placeholder={t("titlePh")} />
          </Field>
          <Field label={t("fieldPhone")} hint={t("optional")}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!canManage} placeholder="+1 (555) 123-4567" />
          </Field>
          <Field label={t("fieldAddress")} hint={t("optional")}>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canManage} placeholder={t("addressPh")} />
          </Field>
        </div>
        <Field label={t("fieldFooterLine")} hint={t("hintFooterLine")}>
          <Input value={footer} onChange={(e) => setFooter(e.target.value)} disabled={!canManage} placeholder={t("placeholderFooterLine")} />
        </Field>

        {/* Live preview */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted-cream">{t("preview")}</label>
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
              <p className="text-sm text-[#888]">{t("noSignatureHint")}</p>
            )}
          </div>
        </div>

        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

        {canManage ? (
          <div className="flex items-center gap-3">
            <Btn onClick={save} loading={saving}>
              {t("saveSignature")}
            </Btn>
            {saved && (
              <span className="inline-flex items-center gap-1 text-sm text-teal">
                <Check className="h-4 w-4" /> {t("saved")}
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-white/45">{t("onlyOwnerCanEditSignature")}</p>
        )}
      </div>
    </Panel>
  );
}
