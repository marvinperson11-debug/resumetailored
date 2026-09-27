"use client";

import { useState } from "react";
import { Calculator, BarChart3, Table, FileBarChart } from "lucide-react";
import { PageHeader } from "../components/ui";
import { CalculatorsTab } from "./calculators-client";
import { ChartsTab } from "./charts-client";
import { SpreadsheetTab } from "./spreadsheet-client";
import { ReportTab } from "./report-client";

export type OfficeTab = "calculators" | "charts" | "spreadsheet" | "report";
const TAB_META: Record<OfficeTab, { label: string; icon: typeof Calculator }> = {
  calculators: { label: "Calculators", icon: Calculator },
  charts: { label: "Charts", icon: BarChart3 },
  spreadsheet: { label: "Spreadsheet Creator", icon: Table },
  report: { label: "Report Writer", icon: FileBarChart },
};

/**
 * Office suite home. Plain business-tool names on purpose (no "AI" in the
 * names — the copy inside a tool may mention AI assistance where it applies,
 * but the product surface reads like ordinary office software). Calculators
 * is on every tier; Charts, Spreadsheet Creator, and Report Writer are Scale+
 * (Presentation Builder will join them here in a later phase — not built yet).
 */
export function OfficeClient({
  canCharts,
  canSpreadsheet,
  canReport,
  canManage,
  initialTab,
}: {
  canCharts: boolean;
  canSpreadsheet: boolean;
  canReport: boolean;
  canManage: boolean;
  initialTab?: OfficeTab;
}) {
  const [tab, setTab] = useState<OfficeTab>(initialTab ?? "calculators");

  return (
    <div>
      <PageHeader title="Office" subtitle="Business calculators and charts, built into the portal." />
      <div className="mb-6 inline-flex rounded-lg border border-border-gold bg-white/[0.03] p-1">
        {(Object.keys(TAB_META) as OfficeTab[]).map((t) => {
          const Icon = TAB_META[t].icon;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
                tab === t ? "bg-violet text-white" : "text-muted-cream hover:text-cream"
              }`}
            >
              <Icon className="h-4 w-4" />
              {TAB_META[t].label}
            </button>
          );
        })}
      </div>
      {tab === "calculators" && <CalculatorsTab />}
      {tab === "charts" && <ChartsTab canCharts={canCharts} canManage={canManage} />}
      {tab === "spreadsheet" && <SpreadsheetTab canSpreadsheet={canSpreadsheet} canManage={canManage} />}
      {tab === "report" && <ReportTab canReport={canReport} canManage={canManage} />}
    </div>
  );
}
