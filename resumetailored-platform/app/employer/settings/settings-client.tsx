"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { INDUSTRIES, COMPANY_SIZES, type EmployerProfile } from "@/lib/employer-ai";
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
