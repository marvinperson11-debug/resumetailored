import { getAccess } from "@/lib/plan";
import { teamSeatLimit } from "@/lib/employer-plan";
import { TeamClient } from "./team-client";

export const dynamic = "force-dynamic";

export default async function TeamPage({ searchParams }: { searchParams: { invite?: string } }) {
  const access = await getAccess();
  // Only the employer owner can manage the roster; employees see it read-only.
  const canManage = access.plan === "employer";
  const limit = teamSeatLimit(access);
  return <TeamClient canManage={canManage} openInvite={searchParams?.invite === "1"} seatLimit={limit === Infinity ? null : limit} />;
}
