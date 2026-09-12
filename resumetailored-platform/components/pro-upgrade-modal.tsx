"use client";

import { Check, Crown, X, Loader2 } from "lucide-react";

const INCLUDED = [
  "All 104 resume & cover-letter templates",
  "Watermark-free PDF / DOCX / TXT exports",
  "Resume Video studio",
  "Personal portfolio website",
  "The full Career Hub",
];

export function ProUpgradeModal({
  open,
  loading,
  error,
  onStart,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  error: string | null;
  onStart: (plan: "pro" | "lifetime") => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pro-upgrade-title"
    >
      <div
        className="absolute inset-0 bg-navy/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border-gold bg-navy shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-muted-cream transition-colors hover:text-cream"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="px-7 pb-7 pt-8">
          <div className="mb-4 flex items-center gap-2">
            <Crown className="h-5 w-5 text-gold" />
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-gold">
              ResumeTailored Pro
            </span>
          </div>

          <h2
            id="pro-upgrade-title"
            className="font-serif text-2xl font-medium text-cream"
          >
            Upgrade to Pro
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-cream">
            Unlock Resume Video, Web Studio, and unlimited resume building.
          </p>

          <ul className="mt-5 space-y-2.5">
            {INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-cream">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          {error && (
            <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() => onStart("pro")}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet px-5 py-3.5 text-sm font-semibold text-white shadow-[0_0_22px_rgba(194,135,11,0.4)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet/90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Opening secure checkout…
                </>
              ) : (
                "Start Pro — $19.00/mo →"
              )}
            </button>
            <button
              type="button"
              onClick={() => onStart("lifetime")}
              disabled={loading}
              className="flex w-full items-center justify-center rounded-xl border border-border-gold px-5 py-3 text-sm font-semibold text-cream transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-70"
            >
              Pro Lifetime — $129 one-time →
            </button>
          </div>

          <p className="mt-3 text-center text-xs text-muted-cream">
            Secure payment by Stripe. Cancel the monthly plan anytime.
          </p>
        </div>
      </div>
    </div>
  );
}
