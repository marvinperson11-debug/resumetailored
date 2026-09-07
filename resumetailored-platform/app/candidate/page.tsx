import { auth } from "@clerk/nextjs/server";
import { getGenerationStats, type GenerationStats } from "@/lib/generations";
import { DashboardHome } from "./components/dashboard-home";

// Server component: pull the user's real generation stats (best-effort) and
// hand them to the client dashboard. Never cache — stats change per tool use.
export const dynamic = "force-dynamic";

export default async function CandidateDashboard() {
  const { userId } = await auth();
  const stats: GenerationStats = userId
    ? await getGenerationStats(userId)
    : { resumes: 0, coverLetters: 0, atsTotal: 0, atsToday: 0 };
  return <DashboardHome stats={stats} />;
}
