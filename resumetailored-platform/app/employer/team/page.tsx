import { auth } from "@clerk/nextjs/server";
import { getAccess } from "@/lib/plan";
import { teamSeatLimit } from "@/lib/employer-plan";
import { TeamClient } from "./team-client";

export const dynamic = "force-dynamic";

export default async function TeamPage({ searchParams }: { searchParams: { invite?: string } }) {
  const { userId } = await auth();
  const access = await getAccess();
  // Only the employer owner can manage the roster; employees see it read-only.
  // Signed-out = the anonymous employer taste: a brand-new account IS its own
  // owner from the moment it exists, so this reads true there too — actually
  // sending an invite is gated client-side (useEmployerDemo).
  const canManage = !userId || access.plan === "employer";
  const limit = teamSeatLimit(access);
  return <TeamClient canManage={canManage} openInvite={searchParams?.invite === "1"} seatLimit={limit === Infinity ? null : limit} />;
}
