import Link from "next/link";
import { FileText, MessageSquare, Megaphone, Pin, CalendarDays, Clock, CalendarClock, ClipboardCheck } from "lucide-react";
import { employeeContext } from "@/lib/employee-auth";
import { listActiveAnnouncements } from "@/lib/announcements-store";
import { getLatestEmployeeChecklist } from "@/lib/checklist-store";
import { checklistProgress } from "@/lib/checklist-hub";
import { TimeClockWidget } from "./time-clock-widget";

export const dynamic = "force-dynamic";

/** Employee portal home: a greeting, pinned announcements from the employer, and
 *  quick links into the tools. (The layout already gates access, so ctx is
 *  present here; the null-guard is just for type-narrowing.) */
export default async function EmployeeHomePage() {
  const ctx = await employeeContext();
  if (!ctx) return null;

  const [announcements, checklist] = await Promise.all([
    listActiveAnnouncements(ctx.employerId),
    getLatestEmployeeChecklist(ctx.employerId, ctx.employeeId),
  ]);
  const first = ctx.employee.name.trim().split(/\s+/)[0] || "there";

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <h1 className="font-serif text-3xl font-medium text-cream">Hi {first} 👋</h1>
        <p className="mt-1 text-sm text-white/60">
          {ctx.employee.role ? `${ctx.employee.role} · ` : ""}Welcome to your employee portal.
        </p>
      </header>

      {/* Time clock */}
      <TimeClockWidget />

      {/* Onboarding checklist — read-only here; the employer checks off items. */}
      {checklist && (
        <section className="glass px-5 py-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-white/70">
              <ClipboardCheck className="h-4 w-4 text-violet" /> {checklist.name}
            </div>
            <span className="text-xs text-white/40">{checklistProgress(checklist.items)}% complete</span>
          </div>
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-violet transition-all" style={{ width: `${checklistProgress(checklist.items)}%` }} />
          </div>
          <ul className="space-y-1.5">
            {checklist.items.map((it) => (
              <li key={it.id} className="flex items-center gap-2 text-sm">
                <span
                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${it.done ? "border-violet bg-violet" : "border-white/25"}`}
                >
                  {it.done && <span className="h-1.5 w-1.5 rounded-sm bg-white" />}
                </span>
                <span className={it.done ? "text-white/40 line-through" : "text-white/80"}>{it.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
        <QuickCard href="/employee/schedule" icon={CalendarDays} title="My schedule" body="Your published shifts, and set the hours you're available." />
        <QuickCard href="/employee/timesheet" icon={Clock} title="My hours" body="Your weekly hours and their approval status." />
        <QuickCard href="/employee/time-off" icon={CalendarClock} title="Time off" body="Request vacation, sick or other days off." />
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
