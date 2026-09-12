import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Building2 } from "lucide-react";
import { getPublicJob } from "@/lib/employer-store";
import type { JobPosting } from "@/lib/employer-ai";
import { ApplyForm } from "./apply-form";

export const dynamic = "force-dynamic";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
function salaryLabel(j: JobPosting): string | null {
  if (j.salaryMin && j.salaryMax) return `${money(j.salaryMin)} – ${money(j.salaryMax)} ${j.salaryCurrency || ""}`.trim();
  if (j.salaryMin) return `${money(j.salaryMin)}+`;
  if (j.salaryMax) return `up to ${money(j.salaryMax)}`;
  return null;
}

export default async function PublicJobDetail({ params }: { params: { jobId: string } }) {
  const id = Number(params.jobId);
  const job = Number.isFinite(id) ? await getPublicJob(id) : null;
  if (!job) notFound();
  const sal = salaryLabel(job);

  return (
    <main className="min-h-screen bg-navy">
      <header className="border-b border-border-gold">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/jobs" className="inline-flex items-center gap-1.5 text-sm text-muted-cream hover:text-cream"><ArrowLeft className="h-4 w-4" /> All jobs</Link>
          <Link href="/" className="font-serif text-lg font-medium text-cream">ResumeTailored <span className="text-violet">Jobs</span></Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="font-serif text-3xl font-medium text-cream">{job.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/65">
          <span className="inline-flex items-center gap-1"><Building2 className="h-4 w-4" /> {job.company || "A company"}</span>
          {job.location && <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" /> {job.location}</span>}
          {job.remoteType && <span className="rounded bg-teal/15 px-1.5 py-0.5 text-xs text-teal">{job.remoteType}</span>}
          {job.employmentType && <span>{job.employmentType}</span>}
        </div>
        {sal && <p className="mt-2 text-sm font-semibold text-teal">{sal}</p>}

        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">Job description</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/80">{job.description}</p>
        </section>

        {job.requirements.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">Requirements</h2>
            <ul className="space-y-1">{job.requirements.map((r, i) => <li key={i} className="flex gap-2 text-sm text-white/80"><span className="text-violet">▸</span> {r}</li>)}</ul>
          </section>
        )}
        {job.niceToHaves.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">Nice to have</h2>
            <ul className="space-y-1">{job.niceToHaves.map((r, i) => <li key={i} className="flex gap-2 text-sm text-white/70"><span className="text-white/40">▸</span> {r}</li>)}</ul>
          </section>
        )}

        <section className="mt-8 rounded-2xl border border-border-gold bg-white/[0.03] p-5">
          <h2 className="mb-4 font-serif text-xl font-medium text-cream">Apply for this role</h2>
          <ApplyForm jobId={job.id} />
        </section>
      </div>
    </main>
  );
}
