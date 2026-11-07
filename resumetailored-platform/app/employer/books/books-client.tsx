"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Receipt, FileText, Landmark, BarChart3 } from "lucide-react";
import { PageHeader, LockedModuleBanner } from "../components/ui";
import { EntriesTab } from "./entries-tab";
import { InvoicesTab } from "./invoices-tab";
import { BankTab } from "./bank-tab";
import { ReportsTab } from "./reports-tab";
import { TaylorBooksWidget } from "./taylor-widget";

export type BooksTab = "entries" | "invoices" | "bank" | "reports";
const TAB_ICON: Record<BooksTab, typeof Receipt> = { entries: Receipt, invoices: FileText, bank: Landmark, reports: BarChart3 };

/**
 * Books home — lightweight bookkeeping inside the employer portal. `locked`
 * (Free tier, below Books' Portal floor) renders the SAME visible-but-locked
 * pattern as Employees Hub/Time Suite/Office (LockedModuleBanner, page still
 * renders view-only underneath) rather than a hard block. `canFull` (Scale
 * vs. Corporate) decides whether the full-Books surfaces (bank feeds,
 * tax-ready exports, the hiring tie-in) render unlocked or as a Scale
 * "taste" — each tab's own component handles that split, not this shell.
 */
export function BooksClient({ locked, canFull, canManage, initialTab }: { locked: boolean; canFull: boolean; canManage: boolean; initialTab?: BooksTab }) {
  const t = useTranslations("employerBooks");
  const [tab, setTab] = useState<BooksTab>(initialTab ?? "entries");

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <a href="/employer/books/about" className="text-sm text-violet hover:underline">
            {t("howItWorks")}
          </a>
        }
      />
      {locked && <LockedModuleBanner featureKey="books" tier="Portal" />}
      {!locked && <TaylorBooksWidget />}
      <div className="mb-6 inline-flex rounded-lg border border-border-gold bg-white/[0.03] p-1">
        {(Object.keys(TAB_ICON) as BooksTab[]).map((tabId) => {
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
              {t(`tabs.${tabId}` as "tabs.entries")}
            </button>
          );
        })}
      </div>
      {tab === "entries" && <EntriesTab locked={locked} canFull={canFull} canManage={canManage} />}
      {tab === "invoices" && <InvoicesTab locked={locked} canManage={canManage} />}
      {tab === "bank" && <BankTab locked={locked} canFull={canFull} />}
      {tab === "reports" && <ReportsTab locked={locked} canFull={canFull} />}
    </div>
  );
}
