"use client";

import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { PRICES_USD } from "@/lib/format";
import { useFormat } from "@/lib/use-format";

const UPGRADE_HREF = "/candidate?upgrade=pro";

/**
 * Post-tailoring conversion block for FREE users, rendered inline under the tailored result
 * (never a modal). It only mounts when the server's ATS-report route answered `locked`
 * (which is decided by canUseIndividualPro), so Pro accounts never see it.
 *
 * The single visible keyword is real: it comes from the actual before/after keyword delta of
 * this tailoring (free-tier deterministic scorer, see /api/tailor/ats-report). Everything else
 * Pro would show is drawn as blurred, text-free placeholders — nothing invented is displayed.
 */
export function LockedConversionPreview({
  keyword,
  kind,
  addedCount,
}: {
  keyword: string | null;
  kind: "added" | "strengthened" | null;
  addedCount: number;
}) {
  const t = useTranslations("candidateTools.resumeTailor.lockedPreview");
  const fmt = useFormat();
  const blurredChips = Math.min(5, Math.max(2, addedCount - 1));
  const body = !keyword
    ? t("atsBodyNoKeyword")
    : t.rich(kind === "strengthened" ? "atsBodyStrengthened" : "atsBodyAdded", {
        keyword,
        code: (chunks) => <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[12px] text-cream">{chunks}</code>,
      });

  return (
    <section aria-label={t("headline")} className="border-t border-border-gold px-4 py-4">
      <h3 className="text-sm font-semibold text-cream">{t("headline")}</h3>

      <div className="mt-3 rounded-xl border border-border-gold bg-white/[0.04] p-3.5">
        <div className="flex items-center gap-2 text-xs font-bold text-gold">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" /> {t("atsTitle")}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-white/70">{body}</p>
        <div aria-hidden="true" className="mt-2.5 flex flex-wrap items-center gap-1.5 select-none blur-[3px]">
          {Array.from({ length: blurredChips }).map((_, i) => (
            <span key={i} className="h-5 rounded-full bg-white/20" style={{ width: `${56 + ((i * 17) % 40)}px` }} />
          ))}
          <span className="ml-2 h-5 w-24 rounded bg-white/15" />
        </div>
      </div>

      <div className="mt-2.5 rounded-xl border border-border-gold bg-white/[0.04] p-3.5">
        <div className="flex items-center gap-2 text-xs font-bold text-gold">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" /> {t("variantsTitle")}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-white/70">{t("variantsBody")}</p>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <a href={UPGRADE_HREF} className="rounded-full bg-gold px-4 py-2 text-xs font-bold text-navy transition-colors hover:bg-gold/90">
          {t("cta", { price: fmt.money(PRICES_USD.pro) })}
        </a>
        <a href={UPGRADE_HREF} className="text-[11px] text-white/55 underline-offset-2 hover:text-white hover:underline">
          {t("secondary", { price: fmt.money(PRICES_USD.proLifetime) })}
        </a>
      </div>
    </section>
  );
}
