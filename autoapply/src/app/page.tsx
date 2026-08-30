import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SignInButton } from "@/components/sign-in-button";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");

  return (
    <main className="min-h-screen flex flex-col">
      <header className="container flex items-center justify-between py-6">
        <div className="flex items-center gap-2 font-semibold text-lg">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">⚡</span>
          AutoApply
        </div>
      </header>

      <section className="container flex-1 grid md:grid-cols-2 gap-12 items-center py-12">
        <div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Apply to jobs in <span className="text-primary">seconds</span>, not hours.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            Add a job, let AI score your fit and tailor your resume, then hit
            <strong> Apply</strong>. Our browser extension auto-fills the
            employer&apos;s form on LinkedIn, Greenhouse, Lever, and Workday.
            You always review and submit — nothing is sent without you.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
            <li>✅ AI match score for every posting</li>
            <li>✅ Tailored bullets + cover letter per job</li>
            <li>✅ Auto-filled fields highlighted so you see exactly what changed</li>
          </ul>
          <div className="mt-8">
            <SignInButton />
            <p className="mt-3 text-xs text-muted-foreground">
              Free while in beta. We never submit an application for you.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="text-sm font-medium text-muted-foreground mb-4">Your job queue</div>
          <div className="space-y-3">
            {[
              { c: "Acme Corp", r: "Senior Frontend Engineer", s: 92, st: "Prepared" },
              { c: "Globex", r: "Product Manager", s: 78, st: "New" },
              { c: "Initech", r: "Full-Stack Developer", s: 85, st: "Applied" },
            ].map((j) => (
              <div key={j.c} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="font-medium">{j.r}</div>
                  <div className="text-xs text-muted-foreground">{j.c}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-primary">{j.s}</span>
                  <span className="text-xs rounded-full bg-secondary px-2 py-1">{j.st}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
