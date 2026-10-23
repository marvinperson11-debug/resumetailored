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

      <AckSettingsSection canManage={canManage} />

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

// ── Messaging / standing auto-acknowledgment (Fix Round 2, Section D) ───────
// Read + toggle only — there is no "create" here. A standing template is
// only ever approved through the Assistant chat's confirmation card
// (lib/assistant-mutations.ts `buildSetAckTemplateArtifact` /
// `executeSetAckTemplate`), the same guardrail every other candidate-facing
// send in this feature follows: no text is ever live without having been
// shown to a human first. This section just surfaces what's currently live
// (lib/assistant-ack-settings.ts `listAckSettings`) and lets the owner turn
// it off (`setAckSettingEnabled` via PATCH) — editing the TEXT of a template
// always goes back through chat, by design (see that module's own comment).
interface AckSetting {
  id: string;
  jobId: number | null;
  template: string;
  enabled: boolean;
  actorEmail: string | null;
  createdAt: string;
}

function AckSettingsSection({ canManage }: { canManage: boolean }) {
  const t = useTranslations("employerSettings");
  const [settings, setSettings] = useState<AckSetting[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/employer/assistant/ack-settings");
        const d = (await res.json().catch(() => ({}))) as { settings?: AckSetting[]; error?: string };
        if (res.status === 403 && d.error === "scale_required") {
          setLocked(true);
          return;
        }
        if (!res.ok) {
          setError(t("errorGeneric"));
          return;
        }
        setSettings(d.settings || []);
      } catch {
        setError(t("errorGeneric"));
      }
    })();
  }, [t]);

  async function setEnabled(id: string, enabled: boolean) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/employer/assistant/ack-settings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(t("errorGeneric"));
      setSettings((prev) => (prev || []).map((s) => (s.id === id ? { ...s, enabled } : s)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setBusyId(null);
    }
  }
  const turnOff = (id: string) => setEnabled(id, false);
  const turnOn = (id: string) => setEnabled(id, true);

  // Below Scale tier there is nothing to manage (the Assistant never offers
  // set_ack_template at that tier) — a plain upsell line instead of an empty panel.
  if (locked) {
    return (
      <Panel className="mt-4">
        <h2 className="mb-2 text-sm font-semibold text-cream">{t("messaging")}</h2>
        <p className="text-sm text-white/55">{t("messagingScaleRequired")}</p>
      </Panel>
    );
  }
  if (settings === null) return null; // still loading

  const active = settings.filter((s) => s.enabled);
  const history = settings.filter((s) => !s.enabled);

  // Fix Round 3, Section C: re-enabling an UNCHANGED approved template needs
  // no new approval card — but that can only ever be true of the MOST
  // RECENT row for a scope (employer_id + job_id). `settings` is already
  // newest-first (lib/assistant-ack-settings.ts `listAckSettings`), so the
  // first row seen per scope key is that scope's current state; if it's
  // disabled, it's exactly the "disabled, unchanged, re-enable with one
  // click" case. An OLDER disabled row for the same scope was superseded by
  // a later approval and must stay in history-only — turning it back on
  // would silently resurrect stale text and (since a scope allows at most
  // one enabled row) would collide with whatever the newest row already is.
  const scopeKey = (s: AckSetting) => (s.jobId === null ? "account" : `job:${s.jobId}`);
  const activeScopes = new Set(active.map(scopeKey));
  const seenScopes = new Set<string>();
  const reenableable: AckSetting[] = [];
  for (const s of settings) {
    const key = scopeKey(s);
    if (seenScopes.has(key)) continue;
    seenScopes.add(key);
    if (!s.enabled && !activeScopes.has(key)) reenableable.push(s);
  }
  const reenableIds = new Set(reenableable.map((s) => s.id));
  const olderHistory = history.filter((s) => !reenableIds.has(s.id));

  return (
    <Panel className="mt-4">
      <h2 className="mb-1 text-sm font-semibold text-cream">{t("messaging")}</h2>
      <p className="mb-4 text-xs text-white/55">{t("messagingHint")}</p>

      {!settings.length && <p className="text-sm text-white/55">{t("messagingNoneYet")}</p>}

      {active.map((s) => (
        <div key={s.id} className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">{t("messagingActive")}</p>
            <p className="text-xs text-white/55">{s.jobId !== null ? t("messagingScopeJob") : t("messagingScopeAccount")}</p>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-cream">{s.template}</p>
          {canManage && (
            <div className="mt-3">
              <Btn variant="ghost" onClick={() => turnOff(s.id)} loading={busyId === s.id}>
                {t("messagingTurnOff")}
              </Btn>
            </div>
          )}
        </div>
      ))}

      {reenableable.map((s) => (
        <div key={s.id} className="mb-3 rounded-lg border border-border-gold/60 bg-navy/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/55">{t("messagingOff")}</p>
            <p className="text-xs text-white/55">{s.jobId !== null ? t("messagingScopeJob") : t("messagingScopeAccount")}</p>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-cream">{s.template}</p>
          {canManage && (
            <div className="mt-3">
              <Btn variant="ghost" onClick={() => turnOn(s.id)} loading={busyId === s.id}>
                {t("messagingTurnOn")}
              </Btn>
            </div>
          )}
        </div>
      ))}

      {olderHistory.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-white/45">{t("messagingHistory")}</summary>
          <div className="mt-2 space-y-2">
            {olderHistory.map((s) => (
              <div key={s.id} className="rounded-lg border border-border-gold/60 bg-navy/40 p-3 opacity-70">
                <p className="text-xs text-white/45">{s.jobId !== null ? t("messagingScopeJob") : t("messagingScopeAccount")}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-cream">{s.template}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      {error && <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
    </Panel>
  );
}
