import Link from "next/link";
import { Search, MapPin, Briefcase } from "lucide-react";
import { listPublicJobs } from "@/lib/employer-store";
import { EMPLOYMENT_TYPES, REMOTE_TYPES, type JobPosting } from "@/lib/employer-ai";

export const dynamic = "force-dynamic";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
function salaryLabel(j: JobPosting): string | null {
  if (j.salaryMin && j.salaryMax) return `${money(j.salaryMin)} – ${money(j.salaryMax)}`;
  if (j.salaryMin) return `${money(j.salaryMin)}+`;
  if (j.salaryMax) return `up to ${money(j.salaryMax)}`;
  return null;
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}

/** Public job board (Feature E) — no auth. Filters via a GET form (SSR). */
export default async function PublicJobsPage({
  searchParams,
}: {
  searchParams: { q?: string; location?: string; type?: string; remote?: string; minSalary?: string };
}) {
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
          <Link href="/" className="font-serif text-lg font-medium text-cream">ResumeTailored <span className="text-violet">Jobs</span></Link>
          <Link href="/employer" className="text-sm text-muted-cream hover:text-cream">For employers →</Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className="font-serif text-3xl font-medium text-cream">Open roles</h1>
        <p className="mt-1 text-sm text-white/60">{jobs.length} active {jobs.length === 1 ? "posting" : "postings"} from employers hiring now.</p>

        {/* Filters (GET form → SSR) */}
        <form method="GET" className="mt-6 grid grid-cols-1 gap-3 rounded-2xl border border-border-gold bg-white/[0.03] p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <input name="q" defaultValue={searchParams.q || ""} placeholder="Keywords (title, company)" className={input} />
          </div>
          <input name="location" defaultValue={searchParams.location || ""} placeholder="Location" className={input} />
          <select name="type" defaultValue={searchParams.type || ""} className={input}>
            <option value="">Any type</option>
            {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select name="remote" defaultValue={searchParams.remote || ""} className={input}>
            <option value="">Any location type</option>
            {REMOTE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select name="minSalary" defaultValue={searchParams.minSalary || ""} className={input}>
            <option value="">Any salary</option>
            <option value="60000">$60k+</option>
            <option value="100000">$100k+</option>
            <option value="150000">$150k+</option>
          </select>
          <div className="sm:col-span-2 lg:col-span-6">
            <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white hover:bg-violet/90">
              <Search className="h-4 w-4" /> Search
            </button>
          </div>
        </form>

        {/* Results */}
        <div className="mt-6 space-y-3">
          {jobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border-gold p-12 text-center text-sm text-white/50">
              No roles match your search. Try broader keywords or clear the filters.
            </div>
          ) : (
            jobs.map((j) => {
              const sal = salaryLabel(j);
              return (
                <Link key={j.id} href={`/jobs/${j.id}`} className="block rounded-2xl border border-border-gold bg-white/[0.03] p-5 transition-colors hover:border-white/25 hover:bg-white/[0.06]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="truncate font-serif text-lg font-medium text-cream">{j.title}</h2>
                      <p className="text-sm text-white/70">{j.company || "A company"}{j.department ? ` · ${j.department}` : ""}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55">
                        {j.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {j.location}</span>}
                        {j.remoteType && <span className="rounded bg-teal/15 px-1.5 py-0.5 text-teal">{j.remoteType}</span>}
                        {j.employmentType && <span>{j.employmentType}</span>}
                        {j.createdAt && <span>· {fmtDate(j.createdAt)}</span>}
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
          <Briefcase className="h-4 w-4" /> Powered by <Link href="/" className="text-violet hover:underline">ResumeTailored</Link>
        </footer>
      </div>
    </main>
  );
}
