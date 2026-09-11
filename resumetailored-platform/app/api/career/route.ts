import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getProfile, listGoals, listMilestones } from "@/lib/career-store";

export const runtime = "nodejs";

/** Load the user's whole Career Hub state in one call. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const [profile, goals, milestones] = await Promise.all([getProfile(userId), listGoals(userId), listMilestones(userId)]);
  return NextResponse.json({ profile, goals, milestones });
}
