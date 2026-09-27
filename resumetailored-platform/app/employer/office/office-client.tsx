"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Calculator, BarChart3, Table, FileBarChart, Presentation } from "lucide-react";
import { PageHeader } from "../components/ui";
import { CalculatorsTab } from "./calculators-client";
import { ChartsTab } from "./charts-client";
import { SpreadsheetTab } from "./spreadsheet-client";
import { ReportTab } from "./report-client";
import { PresentationTab } from "./presentation-client";

export type OfficeTab = "calculators" | "charts" | "spreadsheet" | "report" | "presentation";
const TAB_ICON: Record<OfficeTab, typeof Calculator> = {
  calculators: Calculator,
  charts: BarChart3,
  spreadsheet: Table,
  report: FileBarChart,
  presentation: Presentation,
};

/**
 * Office suite home. Plain business-tool names on purpose (no "AI" in the
 * names — the copy inside a tool may mention AI assistance where it applies,
 * but the product surface reads like ordinary office software). Calculators
 * is on every tier; Charts, Spreadsheet Creator, Report Writer, and
 * Presentation Builder are all Scale+ — the last tool of the Office suite.
 */
export function OfficeClient({
  canCharts,
  canSpreadsheet,
  canReport,
  canPresentation,
  canManage,
  initialTab,
}: {
  canCharts: boolean;
  canSpreadsheet: boolean;
  canReport: boolean;
  canPresentation: boolean;
  canManage: boolean;
  initialTab?: OfficeTab;
}) {
  const t = useTranslations("employerOffice");
  const [tab, setTab] = useState<OfficeTab>(initialTab ?? "calculators");

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="mb-6 inline-flex rounded-lg border border-border-gold bg-white/[0.03] p-1">
        {(Object.keys(TAB_ICON) as OfficeTab[]).map((tabId) => {
          const Icon = TAB_ICON[tabId];
          return (
            <button
              key={tabId}
              onClick={() => setTab(tabId)}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
                tab === tabId ? "bg-violet text-white" : "text-muted-cream hover:text-cream"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t(`tabs.${tabId}` as "tabs.calculators")}
            </button>
          );
        })}
      </div>
      {tab === "calculators" && <CalculatorsTab />}
      {tab === "charts" && <ChartsTab canCharts={canCharts} canManage={canManage} />}
      {tab === "spreadsheet" && <SpreadsheetTab canSpreadsheet={canSpreadsheet} canManage={canManage} />}
      {tab === "report" && <ReportTab canReport={canReport} canManage={canManage} />}
      {tab === "presentation" && <PresentationTab canPresentation={canPresentation} canManage={canManage} />}
    </div>
  );
}
