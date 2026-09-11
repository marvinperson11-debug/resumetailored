"use client";

import { Loader2, X, type LucideIcon } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Employer Portal UI kit. Same navy/violet tokens as the candidate app but a
 * more corporate register: solid panels (bg-white/[0.04] with a hairline
 * border), less glow, denser tables. Kept separate from the candidate `ui.tsx`
 * so the two areas can diverge without stepping on each other.
 */

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-xl border border-border-gold bg-white/[0.04] p-5", className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-serif text-2xl font-medium text-cream">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-white/60">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Btn({
  children,
  loading,
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: "primary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-violet text-white hover:bg-violet/90",
    ghost: "border border-border-gold bg-white/[0.03] text-cream hover:bg-white/[0.08]",
    danger: "border border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20",
  }[variant];
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        styles,
        className
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-cream">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-white/40">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-white/35 outline-none transition-colors focus:border-violet focus:ring-1 focus:ring-violet",
        className
      )}
      {...props}
    />
  );
}

export function Area({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full resize-y rounded-lg border border-border-gold bg-white/5 px-3 py-2.5 text-sm text-cream placeholder:text-white/35 outline-none transition-colors focus:border-violet focus:ring-1 focus:ring-violet",
        className
      )}
      {...props}
    />
  );
}

export function Picker({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      className={cn(
        "w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream outline-none transition-colors focus:border-violet focus:ring-1 focus:ring-violet [&>option]:bg-navy [&>option]:text-cream",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

type Tone = "neutral" | "violet" | "teal" | "gold" | "red" | "sky";
const TONES: Record<Tone, string> = {
  neutral: "bg-white/10 text-white/70",
  violet: "bg-violet/20 text-violet",
  teal: "bg-teal/20 text-teal",
  gold: "bg-gold/20 text-gold",
  red: "bg-red-500/20 text-red-300",
  sky: "bg-sky-500/20 text-sky-300",
};
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold", TONES[tone])}>{children}</span>;
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-gold px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/8">
        <Icon className="h-6 w-6 text-violet" />
      </div>
      <h3 className="font-serif text-lg font-medium text-cream">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-white/55">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Centered modal dialog. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-navy/70 p-4 backdrop-blur-sm sm:p-8">
      <div className={cn("w-full rounded-2xl border border-border-gold bg-navy shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")}>
        <div className="flex items-center justify-between border-b border-border-gold px-5 py-4">
          <h2 className="font-serif text-lg font-medium text-cream">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-cream transition-colors hover:text-cream">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Right-side drawer (candidate detail). */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-navy/60 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full max-w-xl flex-col border-l border-border-gold bg-navy shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-gold px-5 py-4">
          <h2 className="font-serif text-lg font-medium text-cream">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-cream transition-colors hover:text-cream">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/** A score chip coloured by band (green ≥66, amber ≥33, red below). */
export function ScoreChip({ score }: { score: number | null }) {
  if (score === null || score === undefined) return <span className="text-xs text-white/35">—</span>;
  const color = score >= 66 ? "#14B8A6" : score >= 33 ? "#F59E0B" : "#f87171";
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color }}>
      {score}%
    </span>
  );
}
