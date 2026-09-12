import { DashboardSkeleton } from "@/components/dashboard-skeleton";

// Instant fallback while the employer portal's server data loads
// (getAccess() + getEmployerProfile()). Top-nav + card skeletons.
export default function Loading() {
  return <DashboardSkeleton variant="topnav" />;
}
