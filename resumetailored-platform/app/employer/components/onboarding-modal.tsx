"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2 } from "lucide-react";
import { INDUSTRIES } from "@/lib/employer-ai";
import { Btn, Field, Input, Picker } from "./ui";

/**
 * First-run onboarding. Shown over the dashboard until the employer saves a
 * company profile. Blocking by design (no close button) — the portal needs a
 * company name to key everything else off. On success it refreshes the server
 * layout, which then renders the real dashboard.
 */
export function OnboardingModal() {
  const router = useRouter();
  const t = useTranslations("employerOnboarding");
  const ts = useTranslations("employerSettings");
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (companyName.trim().length < 2) {
      setError(t("nameRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/employer/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, companyWebsite, industry }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || t("setupFailed"));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("generic"));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-navy/85 p-4 backdrop-blur-sm sm:items-center sm:p-8">
      <div className="w-full max-w-lg rounded-2xl border border-border-gold bg-navy p-6 shadow-2xl sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet/15">
            <Building2 className="h-5 w-5 text-violet" />
          </div>
          <div>
            <h2 className="font-serif text-xl font-medium text-cream">{t("title")}</h2>
            <p className="text-sm text-white/55">{t("subtitle")}</p>
          </div>
        </div>

        <div className="space-y-4">
          <Field label={t("companyName")}>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder={t("companyNamePh")} autoFocus />
          </Field>
          <Field label={t("companyWebsite")} hint={t("optional")}>
            <Input value={companyWebsite} onChange={(e) => setCompanyWebsite(e.target.value)} placeholder="https://acme.com" />
          </Field>
          <Field label={t("industry")}>
            <Picker value={industry} onChange={(e) => setIndustry(e.target.value)}>
              <option value="">{t("select")}</option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>
                  {ts(`industry.${i}`)}
                </option>
              ))}
            </Picker>
          </Field>

          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

          <Btn onClick={submit} loading={saving} className="w-full">
            {t("complete")}
          </Btn>
        </div>
      </div>
    </div>
  );
}
