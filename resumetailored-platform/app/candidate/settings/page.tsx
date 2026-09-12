import { auth } from "@clerk/nextjs/server";
import { getAccess } from "@/lib/plan";
import { getUserProfile, DEFAULT_PROFILE } from "@/lib/profile-store";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { userId } = await auth();
  const access = await getAccess();
  const profile = userId ? await getUserProfile(userId) : { ...DEFAULT_PROFILE };
  const planLabel =
    access.plan === "pro" ? "Pro" : access.plan === "employee" ? "Pro (via your team)" : access.plan === "employer" ? "Employer" : "Free";
  const isProPlan = access.plan === "pro" || access.plan === "employee";
  return <SettingsClient initial={profile} planLabel={planLabel} isProPlan={isProPlan} />;
}
