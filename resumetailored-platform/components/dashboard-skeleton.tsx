/**
 * Responsive dashboard skeleton, shown as the instant Suspense fallback while a
 * dashboard segment's server data loads (app/candidate/loading.tsx and
 * app/employer/loading.tsx) — so there's never blank white/navy space.
 *
 * It mirrors the real shells so the swap-in isn't jarring:
 *  - variant="sidebar" (candidate): a 260px sidebar that is hidden on mobile
 *    (the real one is a drawer) and expands on desktop — matching DashboardShell.
 *  - variant="topnav"  (employer):  a full-width top bar.
 * Both then show a responsive stat-card row + tool-card grid. Every placeholder
 * is `animate-pulse rounded-xl bg-white/10`, and the grids reflow 1→2→4 columns
 * so it reads correctly on phone, tablet, and desktop in any orientation.
 */

function Box({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-white/10 ${className}`} />;
}

function TopBarSkeleton() {
  return (
    <header className="flex h-16 items-center justify-between gap-3 border-b border-border-gold bg-white/5 px-4 sm:px-6">
      <Box className="h-8 w-32 rounded-lg" />
      <Box className="h-8 w-8 rounded-full" />
    </header>
  );
}

function ContentSkeleton() {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Heading */}
      <Box className="mb-6 h-8 w-56 max-w-[70%]" />
      {/* Stat cards: 1 col (mobile) → 2 (tablet) → 4 (desktop) */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Box key={i} className="h-28 w-full" />
        ))}
      </div>
      {/* Tool cards: 1 col → 2 → 3 */}
      <Box className="mb-4 h-6 w-40" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Box key={i} className="h-40 w-full" />
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton({ variant = "sidebar" }: { variant?: "sidebar" | "topnav" }) {
  if (variant === "topnav") {
    return (
      <div className="min-h-screen bg-navy">
        <TopBarSkeleton />
        <div className="mx-auto max-w-7xl">
          <ContentSkeleton />
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-navy">
      {/* Sidebar: hidden on mobile (real shell uses a drawer), 260px on desktop */}
      <aside className="fixed inset-y-0 left-0 hidden w-[260px] border-r border-border-gold bg-navy p-4 lg:block">
        <Box className="mb-6 h-8 w-40" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Box key={i} className="h-10 w-full" />
          ))}
        </div>
      </aside>
      <div className="lg:pl-[260px]">
        <TopBarSkeleton />
        <ContentSkeleton />
      </div>
    </div>
  );
}
