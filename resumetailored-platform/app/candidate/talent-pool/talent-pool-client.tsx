"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, X, Eye as EyeIcon, Inbox } from "lucide-react";
import type { TalentPoolProfile } from "@/lib/talent-pool-store";
import { TALENT_POOL_VISIBLE_FIELDS, type TalentPoolField, type TalentPoolProfileData } from "@/lib/talent-pool-core";

const card = "rounded-2xl border border-border-gold bg-white/[0.03] p-6";
const labelCls = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-cream";
const inputCls =
  "w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-white/35 outline-none transition-colors focus:border-violet focus:ring-1 focus:ring-violet disabled:opacity-60";

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-cream">{label}</div>
        {hint && <div className="text-xs text-white/45">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-violet" : "bg-white/15"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

function TagInput({ values, onChange, placeholder, removeLabel }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; removeLabel: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-violet/15 px-2.5 py-1 text-xs text-cream">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={removeLabel}>
              <X className="h-3 w-3 text-white/50 hover:text-white" />
            </button>
          </span>
        ))}
      </div>
      <input
        className={inputCls}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

interface IncomingRequest {
  id: string;
  employerCompany: string;
  message: string;
  status: "pending" | "accepted" | "declined" | "withdrawn";
  createdAt: string;
}

export function TalentPoolClient({
  initial,
  initialPreview,
}: {
  initial: TalentPoolProfile;
  initialPreview: Partial<TalentPoolProfileData> | null;
}) {
  const t = useTranslations("candidateTalentPool");
  const tf = useTranslations("candidateTalentPool.fields");

  const [discoverable, setDiscoverable] = useState(initial.isDiscoverable);
  const [headline, setHeadline] = useState(initial.headline);
  const [skills, setSkills] = useState<string[]>(initial.skills);
  const [location, setLocation] = useState(initial.location);
  const [desiredRoles, setDesiredRoles] = useState<string[]>(initial.desiredRoles);
  const [yearsExperience, setYearsExperience] = useState<string>(initial.yearsExperience === null ? "" : String(initial.yearsExperience));
  const [workAuthorization, setWorkAuthorization] = useState(initial.workAuthorization);
  const [bio, setBio] = useState(initial.bio);
  const [visibility, setVisibility] = useState<Record<TalentPoolField, boolean>>(initial.visibility);
  const [preview, setPreview] = useState(initialPreview);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [togglingOptIn, setTogglingOptIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [requests, setRequests] = useState<IncomingRequest[] | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const loadRequests = useCallback(() => {
    fetch("/api/talent-pool/requests", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d: { requests?: IncomingRequest[] }) => setRequests(d.requests || []))
      .catch(() => setRequests([]));
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  async function onToggleDiscoverable(next: boolean) {
    setTogglingOptIn(true);
    setError(null);
    try {
      const res = await fetch("/api/talent-pool/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discoverable: next }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || t("errors.generic"));
      setDiscoverable(next);
      if (!next) loadRequests(); // pending inbound requests just got auto-withdrawn
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setTogglingOptIn(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/talent-pool/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline,
          skills,
          location,
          desiredRoles,
          yearsExperience: yearsExperience.trim() === "" ? null : Number(yearsExperience),
          workAuthorization,
          bio,
          visibility,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; profile?: TalentPoolProfile };
      if (!res.ok) throw new Error(d.error || t("errors.save"));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      // Refresh the preview from the server's own projection, not a local guess.
      fetch("/api/talent-pool/profile", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((pd: { preview?: Partial<TalentPoolProfileData> } | null) => {
          if (pd?.preview) setPreview(pd.preview);
        })
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setSaving(false);
    }
  }

  async function respond(id: string, status: "accepted" | "declined") {
    setRespondingId(id);
    try {
      const res = await fetch(`/api/talent-pool/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) loadRequests();
    } finally {
      setRespondingId(null);
    }
  }

  const pending = (requests || []).filter((r) => r.status === "pending");
  const resolved = (requests || []).filter((r) => r.status !== "pending");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-medium text-cream">{t("title")}</h1>
        <p className="mt-1 text-sm text-white/60">{t("subtitle")}</p>
      </div>

      <div className={card}>
        <Toggle on={discoverable} onChange={onToggleDiscoverable} label={t("optIn.label")} hint={t("optIn.hint")} />
        {togglingOptIn && <Loader2 className="h-4 w-4 animate-spin text-white/50" />}
      </div>

      {discoverable && (
        <>
          <div className={card}>
            <h2 className="mb-4 text-sm font-semibold text-cream">{t("profileTitle")}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelCls}>{tf("headline")}</label>
                <input className={inputCls} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder={tf("headlinePh")} />
              </div>
              <div>
                <label className={labelCls}>{tf("location")}</label>
                <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder={tf("locationPh")} />
              </div>
              <div>
                <label className={labelCls}>{tf("yearsExperience")}</label>
                <input
                  type="number"
                  min={0}
                  className={inputCls}
                  value={yearsExperience}
                  onChange={(e) => setYearsExperience(e.target.value)}
                  placeholder={tf("yearsExperiencePh")}
                />
              </div>
              <div>
                <label className={labelCls}>{tf("workAuthorization")}</label>
                <input className={inputCls} value={workAuthorization} onChange={(e) => setWorkAuthorization(e.target.value)} placeholder={tf("workAuthorizationPh")} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>{tf("skills")}</label>
                <TagInput values={skills} onChange={setSkills} placeholder={tf("skillsPh")} removeLabel={tf("remove")} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>{tf("desiredRoles")}</label>
                <TagInput values={desiredRoles} onChange={setDesiredRoles} placeholder={tf("desiredRolesPh")} removeLabel={tf("remove")} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>{tf("bio")}</label>
                <textarea className={inputCls + " resize-y"} rows={4} value={bio} onChange={(e) => setBio(e.target.value)} placeholder={tf("bioPh")} />
              </div>
            </div>
          </div>

          <div className={card}>
            <h2 className="mb-1 text-sm font-semibold text-cream">{t("visibilityTitle")}</h2>
            <p className="mb-3 text-xs text-white/50">{t("visibilityHint")}</p>
            <div className="divide-y divide-border-gold/40">
              {TALENT_POOL_VISIBLE_FIELDS.map((f) => (
                <Toggle
                  key={f}
                  on={visibility[f] !== false}
                  onChange={(v) => setVisibility((prev) => ({ ...prev, [f]: v }))}
                  label={tf(`visible.${f}`)}
                />
              ))}
            </div>
          </div>

          {preview && (
            <div className={card}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-cream">
                <EyeIcon className="h-4 w-4 text-violet" /> {t("previewTitle")}
              </h2>
              <div className="rounded-xl border border-border-gold bg-white/[0.02] p-4">
                <div className="flex items-center gap-3">
                  {preview.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview.photoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-white/10" />
                  )}
                  <div>
                    <div className="text-sm font-semibold text-cream">{preview.name ?? t("previewHiddenField")}</div>
                    <div className="text-xs text-white/55">{preview.headline ?? t("previewHiddenField")}</div>
                  </div>
                </div>
                <dl className="mt-3 space-y-1 text-xs text-white/60">
                  <div>
                    <dt className="inline font-semibold text-white/80">{tf("location")}: </dt>
                    <dd className="inline">{preview.location ?? t("previewHiddenField")}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold text-white/80">{tf("yearsExperience")}: </dt>
                    <dd className="inline">{preview.yearsExperience ?? t("previewHiddenField")}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold text-white/80">{tf("skills")}: </dt>
                    <dd className="inline">{preview.skills?.length ? preview.skills.join(", ") : t("previewHiddenField")}</dd>
                  </div>
                </dl>
              </div>
            </div>
          )}

          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

          <div className="sticky bottom-0 flex items-center gap-3 border-t border-border-gold bg-navy/80 py-4 backdrop-blur">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-violet px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet/90 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("save")}
            </button>
            {saved && (
              <span className="inline-flex items-center gap-1 text-sm text-teal">
                <Check className="h-4 w-4" /> {t("saved")}
              </span>
            )}
          </div>
        </>
      )}

      <div className={card}>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-cream">
          <Inbox className="h-4 w-4 text-violet" /> {t("requestsTitle")}
        </h2>
        {requests === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-white/50" />
        ) : pending.length === 0 && resolved.length === 0 ? (
          <p className="text-sm text-white/55">{t("requestsEmpty")}</p>
        ) : (
          <div className="space-y-3">
            {pending.map((r) => (
              <div key={r.id} className="rounded-xl border border-border-gold bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-cream">{r.employerCompany}</div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-white/70">{r.message}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={respondingId === r.id}
                      onClick={() => respond(r.id, "accepted")}
                      className="rounded-lg bg-violet px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet/90 disabled:opacity-60"
                    >
                      {t("accept")}
                    </button>
                    <button
                      type="button"
                      disabled={respondingId === r.id}
                      onClick={() => respond(r.id, "declined")}
                      className="rounded-lg border border-border-gold px-3 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-white/8 disabled:opacity-60"
                    >
                      {t("decline")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {resolved.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-border-gold/50 bg-white/[0.01] px-4 py-2.5 text-sm">
                <span className="text-white/70">{r.employerCompany}</span>
                <span className="text-xs text-white/45">{t(`status.${r.status}`)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
