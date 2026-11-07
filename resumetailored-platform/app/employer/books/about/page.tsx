import Link from "next/link";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

/**
 * Books landing/how-to page — what it is, what's included per plan, and how
 * to use each part. Not gated (any employer, including Free, can read what
 * upgrading would unlock) and not in the main nav — reached contextually
 * from the Books tool itself ("How it works" link in books-client.tsx),
 * same convention Attribution uses for a page that doesn't need its own
 * permanent nav slot. There's no separate in-app marketing-page layout in
 * this codebase to borrow (see BOOKS.md) — this reuses the ordinary
 * employer-portal page shell like every other `/employer/*` route.
 */
export default async function BooksAboutPage() {
  const t = await getTranslations("employerBooksAbout");

  const steps = ["entries", "csv", "bank", "invoicing", "reports"] as const;
  const plans = ["portal", "scale", "corporate"] as const;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-2xl font-medium text-cream">{t("title")}</h1>
      <p className="mt-2 text-sm text-white/60">{t("intro")}</p>

      <h2 className="mt-8 font-serif text-lg font-medium text-cream">{t("plansTitle")}</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border-gold">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-gold bg-white/[0.03] text-left text-xs uppercase tracking-wide text-white/50">
              <th className="px-4 py-3">{t("plan")}</th>
              <th className="px-4 py-3">{t("includes")}</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p} className="border-b border-border-gold/50">
                <td className="px-4 py-3 font-medium text-cream">{t(`plans.${p}.name`)}</td>
                <td className="px-4 py-3 text-white/70">{t(`plans.${p}.body`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 font-serif text-lg font-medium text-cream">{t("howToTitle")}</h2>
      <div className="mt-3 space-y-5">
        {steps.map((s) => (
          <div key={s}>
            <h3 className="font-medium text-cream">{t(`steps.${s}.title`)}</h3>
            <p className="mt-1 text-sm text-white/60">{t(`steps.${s}.body`)}</p>
          </div>
        ))}
      </div>

      <Link href="/employer/books" className="mt-8 inline-block rounded-lg bg-violet px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet/90">
        {t("openBooks")}
      </Link>
    </div>
  );
}
