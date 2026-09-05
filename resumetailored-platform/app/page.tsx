import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-8">
        <span className="fade-up text-xs font-medium uppercase tracking-[0.32em] text-violet">
          Resume Tailored
        </span>

        <h1 className="fade-up font-serif text-4xl font-medium leading-tight text-white sm:text-5xl md:text-6xl">
          Your next move, properly considered.
        </h1>

        <p
          className="fade-up max-w-md text-base text-white/70 sm:text-lg"
          style={{ animationDelay: "0.3s" }}
        >
          A private office for your ambitions.
        </p>

        <div
          className="fade-up mt-4 flex flex-col items-center gap-4 sm:flex-row"
          style={{ animationDelay: "0.6s" }}
        >
          <Link
            href="/dashboard/employer"
            className="rounded-xl bg-violet px-6 py-3 text-sm font-semibold text-white shadow-[0_0_20px_rgba(139,92,246,0.3)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_28px_rgba(139,92,246,0.45)]"
          >
            For Employers — Start Hiring
          </Link>

          <Link
            href="/dashboard/candidate"
            className="glass glass-hover rounded-xl px-6 py-3 text-sm font-semibold text-white"
          >
            For Candidates — Tailor My Resume
          </Link>
        </div>
      </div>
    </main>
  );
}
