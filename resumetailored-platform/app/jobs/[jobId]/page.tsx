import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Building2 } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/format";
import { getPublicJob } from "@/lib/employer-store";
import type { JobPosting } from "@/lib/employer-ai";
import { ApplyForm } from "./apply-form";

export const dynamic = "force-dynamic";

function salaryLabel(j: JobPosting, locale: string, upTo: (amount: string) => string): string | null {
  if (j.salaryMin && j.salaryMax) return `${formatMoney(j.salaryMin, locale, { currency: j.salaryCurrency })} – ${formatMoney(j.salaryMax, locale, { currency: j.salaryCurrency })}`;
  if (j.salaryMin) return `${formatMoney(j.salaryMin, locale, { currency: j.salaryCurrency })}+`;
  if (j.salaryMax) return upTo(formatMoney(j.salaryMax, locale, { currency: j.salaryCurrency }));
  return null;
}

export default async function PublicJobDetail({ params }: { params: { jobId: string } }) {
  const id = Number(params.jobId);
  const job = Number.isFinite(id) ? await getPublicJob(id) : null;
  if (!job) notFound();
  const t = await getTranslations("publicJobs");
  const locale = await getLocale();
  const sal = salaryLabel(job, locale, (amount) => t("salaryUpTo", { amount }));

  return (
    <main className="min-h-screen bg-navy">
      <header className="border-b border-border-gold">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/jobs" className="inline-flex items-center gap-1.5 text-sm text-muted-cream hover:text-cream"><ArrowLeft className="h-4 w-4" /> {t("allJobs")}</Link>
          <Link href="/" className="font-serif text-lg font-medium text-cream">ResumeTailored <span className="text-violet">{t("brandJobs")}</span></Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="font-serif text-3xl font-medium text-cream">{job.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/65">
          <span className="inline-flex items-center gap-1"><Building2 className="h-4 w-4" /> {job.company || t("aCompany")}</span>
          {job.location && <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" /> {job.location}</span>}
          {job.remoteType && <span className="rounded bg-teal/15 px-1.5 py-0.5 text-xs text-teal">{t(`remoteType.${job.remoteType}`)}</span>}
          {job.employmentType && <span>{t(`employmentType.${job.employmentType}`)}</span>}
        </div>
        {sal && <p className="mt-2 text-sm font-semibold text-teal">{sal}</p>}
        {job.companySlug && (
          <Link href={`/careers/${job.companySlug}`} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-violet hover:underline">
            <Building2 className="h-4 w-4" /> {t("aboutCompany", { company: job.company || t("aboutTheCompany") })}
          </Link>
        )}

        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">{t("description")}</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/80">{job.description}</p>
        </section>

        {job.requirements.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">{t("requirements")}</h2>
            <ul className="space-y-1">{job.requirements.map((r, i) => <li key={i} className="flex gap-2 text-sm text-white/80"><span className="text-violet">▸</span> {r}</li>)}</ul>
          </section>
        )}
        {job.niceToHaves.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">{t("niceToHave")}</h2>
            <ul className="space-y-1">{job.niceToHaves.map((r, i) => <li key={i} className="flex gap-2 text-sm text-white/70"><span className="text-white/40">▸</span> {r}</li>)}</ul>
          </section>
        )}

        <section className="mt-8 rounded-2xl border border-border-gold bg-white/[0.03] p-5">
          <h2 className="mb-4 font-serif text-xl font-medium text-cream">{t("applyTitle")}</h2>
          <ApplyForm jobId={job.id} />
        </section>
      </div>
    </main>
  );
}
