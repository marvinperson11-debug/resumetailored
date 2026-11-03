import { getTranslations } from "next-intl/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getAccess, canUseIndividualPro } from "@/lib/plan";
import { getUserProfile, DEFAULT_PROFILE } from "@/lib/profile-store";
import { getSubscriptionStatus, type SubscriptionStatus } from "@/lib/subscription";
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

  // Whether cancellation is pending has to be re-derived from the legacy
  // Stripe side on every load (Clerk metadata only ever says Pro/Free, never
  // cancel_at_period_end) — fetched here, server-side, so it survives a
  // reload rather than living only in client state. Only a real individual
  // Pro subscriber (not an employer's employee, not the admin bypass) has a
  // subscription of their own to report on.
  let subscriptionStatus: SubscriptionStatus | null = null;
  if (access.plan === "pro" && !access.isAdmin) {
    const user = await currentUser();
    const email = user?.emailAddresses?.[0]?.emailAddress;
    if (email) subscriptionStatus = await getSubscriptionStatus(email);
  }

  return <SettingsClient initial={profile} planLabel={planLabel} isProPlan={isProPlan} subscriptionStatus={subscriptionStatus} />;
}
