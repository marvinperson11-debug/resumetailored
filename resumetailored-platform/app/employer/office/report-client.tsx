"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileBarChart, ArrowRight, CheckCircle2 } from "lucide-react";
import { Panel, Field, Input, Picker, Btn, TierUpgradeNote } from "../components/ui";
import { REPORT_SOURCES, type ReportSource } from "@/lib/office-hub";
import type { EmployerDocument } from "@/lib/employer-ai";

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const TODAY = isoDaysAgo(0);
const THIRTY_DAYS_AGO = isoDaysAgo(30);

export function ReportTab({ canReport, canManage }: { canReport: boolean; canManage: boolean }) {
  const t = useTranslations("employerOffice.report");
  const [source, setSource] = useState<ReportSource>("hiring");
  const [start, setStart] = useState(THIRTY_DAYS_AGO);
  const [end, setEnd] = useState(TODAY);
  const [generating, setGenerating] = useState(false);
  const [doc, setDoc] = useState<EmployerDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canReport) return <TierUpgradeNote feature={t("reportWriterFeature")} />;

  async function generate() {
    setGenerating(true);
    setError(null);
    setDoc(null);
    try {
      const res = await fetch("/api/employer/office/report-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, start, end }),
      });
      const d = (await res.json().catch(() => ({}))) as { document?: EmployerDocument; error?: string };
      if (!res.ok || !d.document) {
        setError(d.error || t("errorGenerate"));
        return;
      }
      setDoc(d.document);
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <div className="space-y-5">
        <Panel>
          <h3 className="mb-3 text-sm font-semibold text-cream">{t("reportHeading")}</h3>
          <div className="space-y-3">
            <Field label={t("dataSource")}>
              <Picker value={source} onChange={(e) => setSource(e.target.value as ReportSource)}>
                {REPORT_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sources.${s}` as "sources.hiring")}
                  </option>
                ))}
              </Picker>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("from")}>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} max={end} />
              </Field>
              <Field label={t("to")}>
                <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} min={start} max={TODAY} />
              </Field>
            </div>
          </div>
          {canManage ? (
            <Btn className="mt-4 w-full" onClick={generate} loading={generating}>
              <FileBarChart className="h-4 w-4" /> {t("generateReport")}
            </Btn>
          ) : (
            <p className="mt-4 text-xs text-white/45">{t("onlyOwnerCanGenerate")}</p>
          )}
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        </Panel>
      </div>

      <div>
        <Panel>
          {!doc ? (
            <div className="flex h-[300px] items-center justify-center text-center text-sm text-white/45">
              {t("previewEmptyState")}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal/15">
                <CheckCircle2 className="h-6 w-6 text-teal" />
              </div>
              <h3 className="font-serif text-lg font-medium text-cream">{doc.title}</h3>
              <p className="mt-1.5 max-w-sm text-sm text-white/55">{t("savedNote")}</p>
              <Link
                href="/employer/documents"
                className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-violet px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet/90"
              >
                {t("openInDocuments")} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
