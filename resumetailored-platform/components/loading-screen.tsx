"use client";

import { useEffect, useState } from "react";

/**
 * Branded full-screen loader. Dark navy background, a pulsing gold "RT" mark,
 * and "Loading ResumeTailored…". It has no data dependencies, so it paints
 * instantly and is centered + readable at every viewport (pure flex centering
 * with responsive type/logo sizes — identical on desktop, tablet, and mobile,
 * portrait or landscape).
 *
 * After 5s with no progress it surfaces a "taking longer than expected"
 * message and a Refresh button, in case Clerk or a server segment stalled.
 *
 * Used by the Clerk init gate (app/layout.tsx `<ClerkLoading>`) and the root
 * route loader (app/loading.tsx).
 */
export function LoadingScreen({ label = "Loading ResumeTailored…" }: { label?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-navy px-6 text-center"
    >
      {/* Pulsing gold RT monogram — scales down on small screens. */}
      <div className="flex h-16 w-16 animate-pulse items-center justify-center rounded-2xl bg-gold/15 text-2xl font-extrabold tracking-tight text-gold sm:h-20 sm:w-20 sm:text-3xl">
        RT
      </div>

      <div className="flex flex-col items-center gap-3">
        <p className="text-sm font-medium text-cream sm:text-base">{label}</p>
        {/* Skeleton dots (staggered pulse) */}
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="h-2 w-2 animate-pulse rounded-full bg-gold/70 [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-pulse rounded-full bg-gold/70 [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-pulse rounded-full bg-gold/70" />
        </div>
      </div>

      {slow && (
        <div className="mt-2 flex max-w-xs flex-col items-center gap-3">
          <p className="text-xs text-muted-cream">This is taking longer than expected.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/20"
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}
