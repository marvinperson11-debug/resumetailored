import type { LucideIcon } from "lucide-react";

const CARD_BASE =
  "rounded-lg border border-border-gold bg-teal transition-all duration-200 hover:scale-[1.01]";

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
    <div className={`${CARD_BASE} p-6`}>
      <Icon className="mb-4 h-6 w-6 text-gold" />
      <div className="text-2xl font-bold text-cream">{value}</div>
      <div className="mt-1 text-sm text-muted-cream">{label}</div>
    </div>
  );
}

export function ActivityItem({ text, time }: { text: string; time: string }) {
  return (
    <div className={`${CARD_BASE} flex items-center justify-between gap-4 px-5 py-4`}>
      <span className="text-sm text-cream">{text}</span>
      <span className="shrink-0 text-xs text-muted-cream">{time}</span>
    </div>
  );
}

export function QuickAction({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="rounded-md border border-gold bg-transparent px-5 py-2.5 text-sm font-medium text-gold transition-all duration-200 hover:scale-[1.01] hover:bg-gold/10"
    >
      {label}
    </button>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-serif text-xl font-medium text-cream">{children}</h2>
  );
}
