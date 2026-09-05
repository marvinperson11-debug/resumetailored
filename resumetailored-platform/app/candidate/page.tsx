import { FileText, Send, Sparkles, Calendar } from "lucide-react";
import {
  StatCard,
  ActivityItem,
  QuickAction,
  SectionHeading,
} from "@/components/dashboard-ui";

const stats = [
  { label: "Resume Strength", value: "92/100", icon: FileText },
  { label: "Active Applications", value: "3", icon: Send },
  { label: "New Matches", value: "12 jobs", icon: Sparkles },
  { label: "Next Interview", value: "Tomorrow, 2PM", icon: Calendar },
];

const activity = [
  { text: "TechCorp viewed your resume", time: "1 hour ago" },
  { text: "New match: Senior Engineer at StartupX", time: "3 hours ago" },
  { text: "Application sent to DesignCo", time: "1 day ago" },
  { text: "Interview scheduled with FinanceHub", time: "2 days ago" },
];

const quickActions = ["Tailor Resume", "Browse Jobs", "Update Profile"];

export default function CandidateDashboard() {
  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>

      <section className="space-y-4">
        <SectionHeading>Recent Activity</SectionHeading>
        <div className="space-y-3">
          {activity.map((item) => (
            <ActivityItem key={item.text} {...item} />
          ))}
        </div>
      </section>

      <section className="flex flex-wrap gap-3">
        {quickActions.map((label) => (
          <QuickAction key={label} label={label} />
        ))}
      </section>
    </div>
  );
}
