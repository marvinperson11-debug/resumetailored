import { getTranslations } from "next-intl/server";
import { auth } from "@clerk/nextjs/server";
import { getAccess } from "@/lib/plan";
import { getUserProfile, DEFAULT_PROFILE } from "@/lib/profile-store";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { userId } = await auth();
  const access = await getAccess();
  const profile = userId ? await getUserProfile(userId) : { ...DEFAULT_PROFILE };
  const ts = await getTranslations("shell.plan");
  const planLabel =
    access.plan === "pro" ? ts("pro") : access.plan === "employee" ? ts("proViaTeam") : access.plan === "employer" ? ts("employer") : ts("free");
  const isProPlan = access.plan === "pro" || access.plan === "employee";
  return <SettingsClient initial={profile} planLabel={planLabel} isProPlan={isProPlan} />;
}
