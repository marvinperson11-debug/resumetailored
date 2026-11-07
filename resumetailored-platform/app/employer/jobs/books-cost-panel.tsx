"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { formatMoney } from "@/lib/books-hub";

interface JobCostSummary {
  jobId: number;
  jobTitle: string;
  taggedExpenseCents: number;
  hires: number;
  costPerHireCents: number | null;
}

/**
 * Cost-per-hire for this job — Books' hiring tie-in (spec item 5), mounted
 * inside the job edit modal exactly like DistributionPanel (its own sibling
 * here). Corporate-only (full Books); a Portal/Scale employer sees a short
 * upsell line rather than this panel, same "taste" treatment Books uses
 * everywhere else, but kept to one line here since the job modal isn't the
 * place for a full TierUpgradeNote block.
 */
export function BooksCostPanel({ jobId }: { jobId: number }) {
  const t = useTranslations("employerJobs");
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<JobCostSummary | null>(null);

  useEffect(() => {
    fetch(`/api/employer/books/job-cost?jobId=${jobId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { allowed?: boolean; summary?: JobCostSummary }) => {
        setAllowed(!!d.allowed);
        setSummary(d.summary || null);
      })
      .catch(() => setAllowed(false));
  }, [jobId]);

  if (allowed === null) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border-gold bg-white/[0.03] p-3 text-xs text-white/50">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("booksCost.loading")}
      </div>
    );
  }
  if (!allowed) {
    return (
      <p className="rounded-lg border border-border-gold bg-white/[0.03] p-3 text-xs text-white/50">
        {t("booksCost.lockedCorporate")} <Link href="/employer/books" className="text-violet hover:underline">{t("booksCost.openBooks")}</Link>
      </p>
    );
  }
  if (!summary) return null;

  return (
    <div className="rounded-lg border border-border-gold bg-white/[0.03] p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/60">{t("booksCost.title")}</div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-cream">{t("booksCost.taggedExpense")}</span>
        <span className="text-cream">{formatMoney(summary.taggedExpenseCents)}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-cream">{t("booksCost.hires")}</span>
        <span className="text-cream">{summary.hires}</span>
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-border-gold/50 pt-1 text-sm font-semibold">
        <span className="text-cream">{t("booksCost.costPerHire")}</span>
        <span className="text-cream">{summary.costPerHireCents !== null ? formatMoney(summary.costPerHireCents) : t("booksCost.noHires")}</span>
      </div>
      <Link href="/employer/books" className="mt-2 inline-block text-xs text-violet hover:underline">
        {t("booksCost.openBooks")}
      </Link>
    </div>
  );
}
