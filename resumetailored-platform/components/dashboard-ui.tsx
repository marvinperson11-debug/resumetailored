import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="glass glass-hover p-6">
      <Icon className="mb-4 h-6 w-6 text-violet" />
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="mt-1 text-sm text-white/70">{label}</div>
    </div>
  );
}

export function ActivityItem({ text, time }: { text: string; time: string }) {
  return (
    <div className="glass glass-hover flex items-center justify-between gap-4 px-5 py-4">
      <span className="text-sm text-white">{text}</span>
      <span className="shrink-0 text-xs text-white/60">{time}</span>
    </div>
  );
}

export function QuickAction({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="rounded-xl bg-violet px-5 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_rgba(139,92,246,0.28)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_26px_rgba(139,92,246,0.42)]"
    >
      {label}
    </button>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="font-serif text-xl font-medium text-white">{children}</h2>;
}
