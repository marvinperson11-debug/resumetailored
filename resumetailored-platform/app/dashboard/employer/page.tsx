import { Briefcase, Users, Clock, DollarSign } from "lucide-react";
import {
  StatCard,
  ActivityItem,
  QuickAction,
  SectionHeading,
} from "@/components/dashboard-ui";

const stats = [
  { label: "Open Roles", value: "12", icon: Briefcase },
  { label: "Candidates This Week", value: "48", icon: Users },
  { label: "Avg. Time to Hire", value: "18 days", icon: Clock },
  { label: "Next Payroll", value: "$24,800", icon: DollarSign },
];

const activity = [
  { text: "Sarah Chen applied to Senior Engineer", time: "2 hours ago" },
  { text: "Mike Ross approved PTO request", time: "4 hours ago" },
  { text: "Jennifer Walsh signed offer letter", time: "1 day ago" },
  { text: "New candidate: David Park", time: "2 days ago" },
];

const quickActions = ["Post a Job", "Add Employee", "Run Payroll"];

export default function EmployerDashboard() {
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
