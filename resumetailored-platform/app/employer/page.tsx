import Link from "next/link";
import { Briefcase, Users, UserPlus, UserCog, Bell, Clock, TrendingUp, type LucideIcon } from "lucide-react";
import { requireEmployerId } from "@/lib/employer-auth";
import { getDashboard, type ActivityEntry } from "@/lib/employer-store";
import { Panel } from "./components/ui";

export const dynamic = "force-dynamic";

/** Employer dashboard home — stats row, quick actions, recent activity feed. */
export default async function EmployerHome() {
  const employerId = await requireEmployerId();
  const { stats, activity } = employerId
    ? await getDashboard(employerId)
    : { stats: { activeJobs: 0, totalApplicants: 0, newThisWeek: 0, teamCount: 0 }, activity: [] };

  const cards: { label: string; value: number; icon: LucideIcon }[] = [
    { label: "Active job postings", value: stats.activeJobs, icon: Briefcase },
    { label: "Total applicants", value: stats.totalApplicants, icon: Users },
    { label: "New this week", value: stats.newThisWeek, icon: TrendingUp },
    { label: "Team members", value: stats.teamCount, icon: UserCog },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl font-medium text-cream">Dashboard</h1>
        <p className="mt-1 text-sm text-white/60">Your hiring at a glance.</p>
      </div>

      {/* Stats */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Panel key={c.label} className="flex items-center gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-violet/15">
                <Icon className="h-5 w-5 text-violet" />
              </div>
              <div>
                <div className="text-2xl font-bold text-cream">{c.value}</div>
                <div className="text-xs text-white/60">{c.label}</div>
              </div>
            </Panel>
          );
        })}
      </section>

      {/* Quick actions */}
      <section className="flex flex-wrap gap-3">
        <Link href="/employer/jobs?new=1" className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet/90">
          <Briefcase className="h-4 w-4" /> Post a job
        </Link>
        <Link href="/employer/candidates" className="inline-flex items-center gap-2 rounded-lg border border-border-gold bg-white/[0.03] px-4 py-2.5 text-sm font-semibold text-cream transition-colors hover:bg-white/[0.08]">
          <Users className="h-4 w-4" /> View candidates
        </Link>
        <Link href="/employer/team?invite=1" className="inline-flex items-center gap-2 rounded-lg border border-border-gold bg-white/[0.03] px-4 py-2.5 text-sm font-semibold text-cream transition-colors hover:bg-white/[0.08]">
          <UserPlus className="h-4 w-4" /> Invite team member
        </Link>
      </section>

      {/* Activity */}
      <section>
        <h2 className="mb-3 font-serif text-lg font-medium text-cream">Recent activity</h2>
        {activity.length === 0 ? (
          <Panel className="text-sm text-white/55">No activity yet. Post your first job to start receiving applicants.</Panel>
        ) : (
          <div className="space-y-2.5">
            {activity.map((a, i) => (
              <ActivityRow key={i} entry={a} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const icon = entry.kind === "applicant" ? Users : entry.kind === "expiring" ? Clock : Bell;
  const Icon = icon;
  const tint = entry.kind === "expiring" ? "text-gold" : entry.kind === "team" ? "text-teal" : "text-violet";
  return (
    <Panel className="flex items-center gap-3 py-3.5">
      <Icon className={`h-4 w-4 shrink-0 ${tint}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-cream">{entry.text}</div>
        {entry.meta && <div className="truncate text-xs text-white/50">{entry.meta}</div>}
      </div>
      <span className="shrink-0 text-xs text-white/40">{relativeDate(entry.date)}</span>
    </Panel>
  );
}

function relativeDate(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const day = 864e5;
  if (diff < 0) {
    const days = Math.ceil(-diff / day);
    return days <= 1 ? "soon" : `in ${days}d`;
  }
  if (diff < 36e5) return `${Math.max(1, Math.round(diff / 6e4))}m ago`;
  if (diff < day) return `${Math.round(diff / 36e5)}h ago`;
  return `${Math.round(diff / day)}d ago`;
}
