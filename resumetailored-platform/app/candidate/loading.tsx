import { DashboardSkeleton } from "@/components/dashboard-skeleton";

// Instant fallback while the candidate dashboard's server data loads
// (getAccess() + getGenerationStats()). Responsive sidebar + card skeletons.
export default function Loading() {
  return <DashboardSkeleton variant="sidebar" />;
}
