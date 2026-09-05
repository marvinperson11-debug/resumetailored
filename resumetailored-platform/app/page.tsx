import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-navy px-6 py-12 text-center">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-8">
        <span className="text-xs font-medium uppercase tracking-[0.32em] text-gold">
          Resume Tailored
        </span>

        <h1 className="font-serif text-4xl font-medium leading-tight text-cream sm:text-5xl md:text-6xl">
          Your next move, properly considered.
        </h1>

        <p className="max-w-md text-base text-muted-cream sm:text-lg">
          A private office for your ambitions.
        </p>

        <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row">
          <Link
            href="/dashboard/employer"
            className="rounded-md bg-gold px-6 py-3 text-sm font-semibold text-navy transition-all duration-200 hover:scale-[1.01] hover:bg-[#d4b884]"
          >
            For Employers — Start Hiring
          </Link>

          <Link
            href="/dashboard/candidate"
            className="rounded-md border border-gold bg-transparent px-6 py-3 text-sm font-semibold text-gold transition-all duration-200 hover:scale-[1.01] hover:bg-gold/10"
          >
            For Candidates — Tailor My Resume
          </Link>
        </div>
      </div>
    </main>
  );
}
