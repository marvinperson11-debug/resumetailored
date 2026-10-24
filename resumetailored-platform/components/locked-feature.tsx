import Link from "next/link";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { PRICES_USD } from "@/lib/format";
import { useFormat } from "@/lib/use-format";

/**
 * Full-page access gate shown when a user's role can't reach a feature.
 * - variant "pro": individual Pro tools (Resume Video, Web Studio) reached by a
 *   free user or an employer → offer the in-app Pro upgrade.
 * - variant "employer": the Employer Portal reached by an individual → offers
 *   both paths to get in: the paid Portal plan ($49/mo, the primary action)
 *   and, as a secondary option, claiming the free Employer tier (1 job, 10
 *   candidates, 1 seat) via /employer-checkout?plan=free — no card required,
 *   no Stripe session created.
 */
export function LockedFeature({
  feature,
  variant,
}: {
  feature: string;
  variant: "pro" | "employer";
}) {
  const t = useTranslations("lockedFeature");
  const fmt = useFormat();
  const isPro = variant === "pro";
  const message = isPro ? t("proRequired") : t("employerRequired");

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center">
      <div className="glass w-full px-8 py-14 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
          <Lock className="h-5 w-5 text-gold" />
        </div>
        <h1 className="font-serif text-3xl font-medium text-white sm:text-4xl">{feature}</h1>
        <p className="mx-auto mt-4 max-w-md text-base text-white/70">{message}</p>

        {isPro ? (
          <>
            <Link
              href="/candidate?upgrade=pro"
              className="mt-8 inline-block rounded-xl bg-violet px-6 py-3 text-sm font-semibold text-white shadow-[0_0_20px_rgba(194,135,11,0.3)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_28px_rgba(194,135,11,0.45)]"
            >
              {t("upgradeMonthly", { price: fmt.money(PRICES_USD.pro) })}
            </Link>
            <p className="mt-3 text-xs text-white/40">{t("cancelAnytime")}</p>
          </>
        ) : (
          <>
            <a
              href="/employer-checkout?plan=portal"
              className="mt-8 inline-block rounded-xl bg-violet px-6 py-3 text-sm font-semibold text-white shadow-[0_0_20px_rgba(194,135,11,0.3)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_28px_rgba(194,135,11,0.45)]"
            >
              {t("learnEmployer")}
            </a>
            <p className="mt-3 text-xs text-white/40">
              {t("billedSeparately")}
            </p>
            <div className="mt-6">
              <a
                href="/employer-checkout?plan=free"
                className="text-sm font-medium text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline"
              >
                {t("claimFree")}
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
