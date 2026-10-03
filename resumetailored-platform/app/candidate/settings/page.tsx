import { getTranslations } from "next-intl/server";
import { auth } from "@clerk/nextjs/server";
import { getAccess, canUseIndividualPro } from "@/lib/plan";
import { getUserProfile, DEFAULT_PROFILE } from "@/lib/profile-store";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { userId } = await auth();
  const access = await getAccess();
  const profile = userId ? await getUserProfile(userId) : { ...DEFAULT_PROFILE };
  const ts = await getTranslations("shell.plan");
  // One key per state — labels are never built by concatenating fragments.
  const planLabel =
    access.plan === "pro" ? (access.lifetime ? ts("proLifetime") : ts("pro")) : access.plan === "employee" ? ts("proViaTeam") : access.plan === "employer" ? ts("employer") : ts("free");
  // Same predicate the tools and API routes use (admin included), so the card never disagrees with them.
  const isProPlan = canUseIndividualPro(access);
  return <SettingsClient initial={profile} planLabel={planLabel} isProPlan={isProPlan} />;
}
