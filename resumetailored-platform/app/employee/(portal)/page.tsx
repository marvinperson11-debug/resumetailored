import Link from "next/link";
import { FileText, MessageSquare, Megaphone, Pin } from "lucide-react";
import { employeeContext } from "@/lib/employee-auth";
import { listActiveAnnouncements } from "@/lib/announcements-store";

export const dynamic = "force-dynamic";

/** Employee portal home: a greeting, pinned announcements from the employer, and
 *  quick links into the tools. (The layout already gates access, so ctx is
 *  present here; the null-guard is just for type-narrowing.) */
export default async function EmployeeHomePage() {
  const ctx = await employeeContext();
  if (!ctx) return null;

  const announcements = await listActiveAnnouncements(ctx.employerId);
  const first = ctx.employee.name.trim().split(/\s+/)[0] || "there";

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <h1 className="font-serif text-3xl font-medium text-cream">Hi {first} 👋</h1>
        <p className="mt-1 text-sm text-white/60">
          {ctx.employee.role ? `${ctx.employee.role} · ` : ""}Welcome to your employee portal.
        </p>
      </header>

      {/* Announcements */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-white/70">
          <Megaphone className="h-4 w-4 text-violet" /> Announcements
        </div>
        {announcements.length === 0 ? (
          <div className="glass px-6 py-8 text-center text-sm text-white/50">No announcements right now.</div>
        ) : (
          <ul className="space-y-3">
            {announcements.map((a) => (
              <li key={a.id} className="glass px-5 py-4">
                <div className="flex items-start gap-2">
                  {a.pinned && <Pin className="mt-0.5 h-4 w-4 shrink-0 text-gold" />}
                  <div className="min-w-0">
                    <div className="font-medium text-cream">{a.title}</div>
                    {a.body && <p className="mt-1 whitespace-pre-wrap text-sm text-white/70">{a.body}</p>}
                    <div className="mt-2 text-xs text-white/40">{new Date(a.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Quick links */}
      <section className="grid gap-4 sm:grid-cols-2">
        <QuickCard href="/employee/documents" icon={FileText} title="My documents" body="Offers, agreements and anything sent to you to sign." />
        <QuickCard href="/employee/messages" icon={MessageSquare} title="Messages" body="Chat directly with your employer." />
      </section>
    </div>
  );
}

function QuickCard({ href, icon: Icon, title, body }: { href: string; icon: typeof FileText; title: string; body: string }) {
  return (
    <Link href={href} className="glass group flex items-start gap-4 px-5 py-5 transition-all duration-200 hover:-translate-y-0.5">
      <span className="rounded-lg bg-violet/15 p-2.5 text-violet">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-cream group-hover:text-violet">{title}</span>
        <span className="mt-0.5 block text-sm text-white/60">{body}</span>
      </span>
    </Link>
  );
}
