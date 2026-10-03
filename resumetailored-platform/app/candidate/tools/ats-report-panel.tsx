"use client";

import { useTranslations } from "next-intl";
import { Loader2, TrendingUp } from "lucide-react";
import { LockedConversionPreview } from "./locked-preview";

export interface AtsReportData {
  before: { score: number; verdict: string };
  after: { score: number; verdict: string };
  delta: number;
  added: string[];
  strengthened: { keyword: string; before: number; after: number }[];
  stillMissing: string[];
  fallback: boolean;
}

export type AtsReportState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "locked"; preview: { keyword: string; kind: "added" | "strengthened" } | null; addedCount: number }
  | { status: "ready"; report: AtsReportData };

/**
 * "ATS rewrite report" shown under the tailored resume. Pro: real keyword delta +
 * before/after match score. Free: a locked row with one real example delta and an
 * upgrade nudge.
 */
export function AtsReportPanel({ state }: { state: AtsReportState }) {
  const t = useTranslations("candidateTools.resumeTailor");

  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-2 border-t border-border-gold px-4 py-3 text-xs text-white/55">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("atsReportLoading")}
      </div>
    );
  }
  if (state.status === "error") {
    return <div className="border-t border-border-gold px-4 py-3 text-xs text-white/45">{t("atsReportError")}</div>;
  }
  if (state.status === "locked") {
    // Free user: the inline conversion block (real keyword from this tailoring + locked rows).
    return <LockedConversionPreview keyword={state.preview?.keyword ?? null} kind={state.preview?.kind ?? null} addedCount={state.addedCount} />;
  }

  const r = state.report;
  return (
    <div className="border-t border-border-gold px-4 py-3 text-xs">
      <div className="mb-2 flex items-center gap-2 font-semibold text-cream">
        <TrendingUp className="h-3.5 w-3.5 text-teal" /> {t("atsReportTitle")}
      </div>
      <div className="mb-3 flex items-center gap-3">
        <ScoreChip label={t("atsBefore")} score={r.before.score} />
        <span className="text-white/40">→</span>
        <ScoreChip label={t("atsAfter")} score={r.after.score} accent />
        <span className={r.delta >= 0 ? "font-semibold text-teal" : "font-semibold text-red-300"}>
          {r.delta >= 0 ? "+" : ""}
          {r.delta}
        </span>
        {r.fallback && <span className="text-[10px] text-white/40">{t("atsEstimated")}</span>}
      </div>
      {r.added.length > 0 && (
        <Group title={t("atsKeywordsAdded")} tone="added">
          {r.added.map((k) => (
            <Chip key={k} tone="added">+ {k}</Chip>
          ))}
        </Group>
      )}
      {r.strengthened.length > 0 && (
        <Group title={t("atsKeywordsStrengthened")} tone="strong">
          {r.strengthened.map((s) => (
            <Chip key={s.keyword} tone="strong">{s.keyword} ×{s.before}→{s.after}</Chip>
          ))}
        </Group>
      )}
      {r.stillMissing.length > 0 && (
        <Group title={t("atsStillMissing")} tone="missing">
          {r.stillMissing.map((k) => (
            <Chip key={k} tone="missing">{k}</Chip>
          ))}
        </Group>
      )}
      {r.added.length === 0 && r.strengthened.length === 0 && <p className="text-white/45">{t("atsNoChange")}</p>}
    </div>
  );
}

function ScoreChip({ label, score, accent }: { label: string; score: number; accent?: boolean }) {
  return (
    <span className="inline-flex flex-col items-center">
      <span className={accent ? "text-lg font-bold text-teal" : "text-lg font-bold text-white/80"}>{score}</span>
      <span className="text-[10px] uppercase tracking-wide text-white/45">{label}</span>
    </span>
  );
}
function Group({ title, children }: { title: string; tone: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/45">{title}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
function Chip({ tone, children }: { tone: "added" | "strong" | "missing"; children: React.ReactNode }) {
  const cls =
    tone === "added" ? "border-teal/40 bg-teal/10 text-teal" : tone === "strong" ? "border-violet/40 bg-violet/10 text-violet" : "border-white/15 bg-white/5 text-white/60";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>{children}</span>;
}
