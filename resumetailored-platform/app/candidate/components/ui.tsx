"use client";

import { Loader2, type LucideIcon } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

export function Label({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-cream">{children}</span>;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full resize-y rounded-xl border border-border-gold bg-white/5 px-3.5 py-3 text-sm text-cream placeholder:text-white/35 outline-none transition-colors focus:border-violet focus:ring-1 focus:ring-violet",
        className
      )}
      {...props}
    />
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-xl border border-border-gold bg-white/5 px-3.5 py-2.5 text-sm text-cream placeholder:text-white/35 outline-none transition-colors focus:border-violet focus:ring-1 focus:ring-violet",
        className
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      className={cn(
        "w-full rounded-xl border border-border-gold bg-white/5 px-3 py-2.5 text-sm text-cream outline-none transition-colors focus:border-violet focus:ring-1 focus:ring-violet [&>option]:bg-navy [&>option]:text-cream",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function PrimaryButton({
  children,
  loading,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl bg-violet px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_18px_rgba(139,92,246,0.32)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_26px_rgba(139,92,246,0.5)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0",
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

export function SecondaryButton({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl border border-border-gold px-4 py-2.5 text-sm font-medium text-cream transition-all duration-200 hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** In-modal placeholder for Phase 2/3 tools. */
export function ComingSoonBody({ feature, icon: Icon, note }: { feature: string; icon?: LucideIcon; note?: string }) {
  return (
    <div className="flex h-full min-h-[300px] flex-col items-center justify-center px-6 py-12 text-center">
      {Icon && (
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/8">
          <Icon className="h-6 w-6 text-violet" />
        </div>
      )}
      <h3 className="font-serif text-2xl font-medium text-cream">{feature}</h3>
      <p className="mt-3 max-w-sm text-sm text-white/60">{note || "This tool is coming soon. We're porting it into your new career office next."}</p>
    </div>
  );
}
