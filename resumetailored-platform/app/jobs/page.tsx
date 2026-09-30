import Link from "next/link";
import { Search, MapPin, Briefcase } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDate, formatMoney } from "@/lib/format";
import { listPublicJobs } from "@/lib/employer-store";
import { EMPLOYMENT_TYPES, REMOTE_TYPES, type JobPosting } from "@/lib/employer-ai";

export const dynamic = "force-dynamic";

function salaryLabel(j: JobPosting, locale: string, upTo: (amount: string) => string): string | null {
  if (j.salaryMin && j.salaryMax) return `${formatMoney(j.salaryMin, locale, { currency: j.salaryCurrency })} – ${formatMoney(j.salaryMax, locale, { currency: j.salaryCurrency })}`;
  if (j.salaryMin) return `${formatMoney(j.salaryMin, locale, { currency: j.salaryCurrency })}+`;
  if (j.salaryMax) return upTo(formatMoney(j.salaryMax, locale, { currency: j.salaryCurrency }));
  return null;
}


/** Public job board (Feature E) — no auth. Filters via a GET form (SSR). */
export default async function PublicJobsPage({
  searchParams,
}: {
  searchParams: { q?: string; location?: string; type?: string; remote?: string; minSalary?: string };
}) {
  const t = await getTranslations("publicJobs");
  const locale = await getLocale();
  const minSalary = Number(searchParams.minSalary);
  const jobs = await listPublicJobs({
    q: searchParams.q,
    location: searchParams.location,
    employmentType: searchParams.type,
    remoteType: searchParams.remote,
    minSalary: Number.isFinite(minSalary) && minSalary > 0 ? minSalary : undefined,
  });

  const input = "w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-white/35 outline-none focus:border-violet [&>option]:bg-navy";

  return (
    <main className="min-h-screen bg-navy">
      <header className="border-b border-border-gold">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="font-serif text-lg font-medium text-cream">ResumeTailored <span className="text-violet">{t("brandJobs")}</span></Link>
          <Link href="/employer" className="text-sm text-muted-cream hover:text-cream">{t("forEmployers")}</Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className="font-serif text-3xl font-medium text-cream">{t("openRoles")}</h1>
        <p className="mt-1 text-sm text-white/60">{t("count", { count: jobs.length })}</p>

        {/* Filters (GET form → SSR) */}
        <form method="GET" className="mt-6 grid grid-cols-1 gap-3 rounded-2xl border border-border-gold bg-white/[0.03] p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <input name="q" defaultValue={searchParams.q || ""} placeholder={t("keywords")} className={input} />
          </div>
          <input name="location" defaultValue={searchParams.location || ""} placeholder={t("location")} className={input} />
          <select name="type" defaultValue={searchParams.type || ""} className={input}>
            <option value="">{t("anyType")}</option>
            {EMPLOYMENT_TYPES.map((ty) => <option key={ty} value={ty}>{t(`employmentType.${ty}`)}</option>)}
          </select>
          <select name="remote" defaultValue={searchParams.remote || ""} className={input}>
            <option value="">{t("anyLocationType")}</option>
            {REMOTE_TYPES.map((ty) => <option key={ty} value={ty}>{t(`remoteType.${ty}`)}</option>)}
          </select>
          <select name="minSalary" defaultValue={searchParams.minSalary || ""} className={input}>
            <option value="">{t("anySalary")}</option>
            <option value="60000">{formatMoney(60000, locale, { compact: true })}+</option>
            <option value="100000">{formatMoney(100000, locale, { compact: true })}+</option>
            <option value="150000">{formatMoney(150000, locale, { compact: true })}+</option>
          </select>
          <div className="sm:col-span-2 lg:col-span-6">
            <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white hover:bg-violet/90">
              <Search className="h-4 w-4" /> {t("search")}
            </button>
          </div>
        </form>

        {/* Results */}
        <div className="mt-6 space-y-3">
          {jobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border-gold p-12 text-center text-sm text-white/50">
              {t("noMatch")}
            </div>
          ) : (
            jobs.map((j) => {
              const sal = salaryLabel(j, locale, (amount) => t("salaryUpTo", { amount }));
              return (
                <Link key={j.id} href={`/jobs/${j.id}`} className="block rounded-2xl border border-border-gold bg-white/[0.03] p-5 transition-colors hover:border-white/25 hover:bg-white/[0.06]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="truncate font-serif text-lg font-medium text-cream">{j.title}</h2>
                      <p className="text-sm text-white/70">{j.company || t("aCompany")}{j.department ? ` · ${j.department}` : ""}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55">
                        {j.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {j.location}</span>}
                        {j.remoteType && <span className="rounded bg-teal/15 px-1.5 py-0.5 text-teal">{t(`remoteType.${j.remoteType}`)}</span>}
                        {j.employmentType && <span>{t(`employmentType.${j.employmentType}`)}</span>}
                        {j.createdAt && <span>· {formatDate(j.createdAt, locale)}</span>}
                      </div>
                      {j.description && <p className="mt-2 line-clamp-2 text-sm text-white/60">{j.description.slice(0, 220)}</p>}
                    </div>
                    {sal && <span className="shrink-0 rounded-full bg-teal/15 px-2.5 py-1 text-xs font-semibold text-teal">{sal}</span>}
                  </div>
                </Link>
              );
            })
          )}
        </div>

        <footer className="mt-12 flex items-center gap-2 border-t border-border-gold pt-6 text-xs text-white/40">
          <Briefcase className="h-4 w-4" /> {t("poweredBy")} <Link href="/" className="text-violet hover:underline">ResumeTailored</Link>
        </footer>
      </div>
    </main>
  );
}
