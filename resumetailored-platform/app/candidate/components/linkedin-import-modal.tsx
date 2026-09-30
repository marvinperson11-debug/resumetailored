"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Contact, Upload, Loader2, Check, X } from "lucide-react";
import type { ParsedLinkedIn } from "@/lib/linkedin-import";

/**
 * Import-from-LinkedIn modal (Feature B). Shared by the resume builder and the
 * profile page. Accepts the export ZIP or pasted JSON, parses it server-side
 * (no AI), shows a preview, and hands the parsed profile to `onApply`.
 */
export function LinkedInImportModal({ onClose, onApply }: { onClose: () => void; onApply: (p: ParsedLinkedIn) => void }) {
  const t = useTranslations("linkedinImport");
  const fileRef = useRef<HTMLInputElement>(null);
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsedLinkedIn | null>(null);

  async function submit(payload: { linkedinJson?: string; linkedinZip?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/linkedin/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = (await res.json().catch(() => ({}))) as { parsedProfile?: ParsedLinkedIn; error?: string };
      if (!res.ok || !d.parsedProfile) throw new Error(d.error || t("errors.read"));
      setPreview(d.parsedProfile);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { setError(t("errors.tooLarge")); return; }
    if (/\.zip$/i.test(file.name)) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      submit({ linkedinZip: dataUrl });
    } else {
      const text = await file.text();
      submit({ linkedinJson: text });
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-navy/80 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-lg rounded-2xl border border-border-gold bg-navy p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-serif text-lg font-medium text-cream"><Contact className="h-5 w-5 text-[#0A66C2]" /> {t("title")}</h2>
          <button type="button" onClick={onClose} aria-label={t("close")} className="rounded-lg p-1.5 text-muted-cream hover:bg-white/10 hover:text-cream"><X className="h-5 w-5" /></button>
        </div>

        {preview ? (
          <div className="space-y-4">
            <p className="text-sm text-white/70">{t("foundIntro")}</p>
            <div className="max-h-[46vh] space-y-3 overflow-y-auto rounded-xl border border-border-gold bg-white/[0.03] p-4 text-sm">
              {preview.name && <Row label={t("name")} value={preview.name} />}
              {preview.headline && <Row label={t("headline")} value={preview.headline} />}
              {preview.location && <Row label={t("location")} value={preview.location} />}
              {preview.summary && <Row label={t("summary")} value={preview.summary} />}
              {preview.experience.length > 0 && <Row label={t("experience", { count: preview.experience.length })} value={preview.experience.map((e) => `${e.title}${e.company ? ` · ${e.company}` : ""}`).join("\n")} />}
              {preview.education.length > 0 && <Row label={t("education", { count: preview.education.length })} value={preview.education.map((e) => `${e.degree ? `${e.degree}, ` : ""}${e.school}`).join("\n")} />}
              {preview.skills.length > 0 && <Row label={t("skills", { count: preview.skills.length })} value={preview.skills.join(", ")} />}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPreview(null)} className="rounded-lg border border-border-gold px-4 py-2 text-sm font-medium text-cream hover:bg-white/8">{t("back")}</button>
              <button type="button" onClick={() => onApply(preview)} className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white hover:bg-violet/90"><Check className="h-4 w-4" /> {t("apply")}</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <ol className="space-y-1.5 rounded-xl border border-border-gold bg-white/[0.03] p-4 text-sm text-white/70">
              <li>{t.rich("step1", { b: (c) => <span className="text-cream">{c}</span> })}</li>
              <li>{t("step2")}</li>
            </ol>

            <input ref={fileRef} type="file" accept=".zip,.json,application/zip,application/json" hidden onChange={onFile} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-gold px-4 py-6 text-sm font-medium text-cream transition-colors hover:bg-white/5 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5 text-violet" />} {t("upload")}
            </button>

            <div className="relative text-center text-xs text-white/40"><span className="bg-navy px-2">{t("orPaste")}</span><div className="absolute inset-x-0 top-1/2 -z-10 h-px bg-white/10" /></div>

            <textarea
              value={json}
              onChange={(e) => setJson(e.target.value)}
              rows={4}
              placeholder={JSON_PLACEHOLDER}
              className="w-full resize-y rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-white/35 outline-none focus:border-violet focus:ring-1 focus:ring-violet"
            />

            {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => submit({ linkedinJson: json })}
                disabled={busy || json.trim().length < 10}
                className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white hover:bg-violet/90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("parse")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const JSON_PLACEHOLDER = JSON.stringify({ firstName: "", lastName: "", headline: "", experience: [] });

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-cream">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap text-white/85">{value}</div>
    </div>
  );
}
